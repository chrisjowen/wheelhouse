import type { Duplex } from 'node:stream';
import WebSocket from 'ws';
import { SessionGuard, type PinsProposal } from './guard';
import type { OriginCertificate } from './origin-cert';
import { OriginServer } from './origin-server';
import { OriginStreams } from './origin-streams';
import type { PinnedPasskey } from './passkeys';
import {
	backoffMs,
	certRequestSig,
	closeAction,
	connectSig,
	decodeFrame,
	DEFAULT_LIMITS,
	e2eKeyBinding,
	machineHost,
	MAX_CONTROL_BYTES,
	PROTOCOL,
	protocolSig,
	SEALED_PROTOCOL,
	type DeviceKey,
	type Limits
} from './protocol';
import { Relay, type RelayContext, type RelayTargets } from './relay';

/**
 * The connector's one socket to the gateway (§4 of the protocol): it dials
 * out over TLS, proves it holds the device key, answers heartbeats, carries
 * the relayed streams, and reconnects with full-jitter backoff after a drop.
 * It stops for good, until it is started again, when the gateway says the
 * device is unknown, removed or replaced, or speaks a newer protocol. With
 * pinned passkeys it serves only the sessions its guard verified (§6.6), and
 * every session from a gateway that cannot have them signed is refused.
 *
 * With its sealed origin on (§12), which only a setting on this machine turns
 * on, the machine is the TLS endpoint for its own web origin: it speaks
 * protocol 3, asks for `sealed-origin`, and terminates the browser's TLS on
 * each `tls` stream itself, so the gateway carries only ciphertext. It then
 * refuses every plaintext `req` and `ws`, and signs nobody into the gateway's
 * relay, whatever the gateway says: behind a gateway that doesn't take the
 * feature it serves nothing at all.
 */

export type ConnectorState = 'connecting' | 'online' | 'stopped';

export interface ConnectorEvents {
	state: (state: ConnectorState, reason: string | null) => void;
	/** Any frame from the gateway (heartbeats included). */
	seen?: () => void;
	relayed?: (relay: RelayContext) => void;
	/** The gateway removed this device (4403): its key must be deleted. */
	revoked?: () => void;
	/**
	 * A trusted passkey signed a new list of pins (§6.6): keep it for the
	 * captain to approve here. It changes nothing until they do.
	 */
	proposed?: (proposal: PinsProposal) => Promise<void>;
	/**
	 * The gateway says this ship's fleet document is now at `version` (§6.11):
	 * ask for it again when that is not the one kept. With this handler the
	 * connector asks for the `fleet` feature; without it, it never hears this.
	 */
	fleetChanged?: (version: string) => void;
	log?: (line: string) => void;
}

export interface ConnectorOptions {
	gateway: string;
	deviceId: string;
	key: DeviceKey;
	version: string;
	/** The passkeys this machine trusts to sign its sessions; null when it was paired without. */
	pins: PinnedPasskey[] | null;
	targets: RelayTargets;
	events: ConnectorEvents;
	random?: () => number;
	now?: () => number;
	/** No `hello` from the gateway in this long after the socket opens: start again. */
	helloMs?: number;
	/** How long a socket must stay ready before backoff starts over. */
	stableMs?: number;
	/** How often the streams of sessions past their limits are looked for and ended. */
	sweepMs?: number;
	/**
	 * This machine's sealed origin is on (§12): the certificate and label it
	 * keeps for its own names. Off unless given.
	 */
	sealedOrigin?: OriginCertificate | null;
}

const HELLO_MS = 15_000;
const STABLE_MS = 60_000;
/** How often the streams of sessions past their limits are looked for and ended. */
const SWEEP_MS = 60_000;
/** The most sessions remembered as reported expired, so each is reported once. */
const MAX_EXPIRED = 256;
/** Why a gateway that negotiated protocol 1 gets nothing from a machine with pins. */
const NOT_SIGNED_HERE =
	'this gateway cannot have sessions signed, so this machine with pinned passkeys serves nothing through it';
/** Why a machine with its sealed origin on refuses the relay the gateway can read (§12.7). */
const SEALED = 'this machine serves only its own origin';
/** What the gateway may still send a sealed machine that it refuses outright: the relay it could read, and §11's sealed relay. */
const SEALED_REFUSED = new Set(['req', 'ws', 'e2e.req', 'e2e.ws']);

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

export function connectUrl(gateway: string): string {
	const u = new URL('/v1/connect', gateway);
	u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
	return u.href;
}

export class Connector {
	state: ConnectorState = 'connecting';
	private ws: WebSocket | null = null;
	private relay: Relay | null = null;
	private attempt = 0;
	private retry: ReturnType<typeof setTimeout> | null = null;
	private watchdog: ReturnType<typeof setTimeout> | null = null;
	private stable: ReturnType<typeof setTimeout> | null = null;
	private sweeper: ReturnType<typeof setInterval> | null = null;
	private stopped = false;
	private readonly random: () => number;
	/** The sessions this machine verified: kept across reconnects, as relay sessions are (§7). */
	readonly guard: SessionGuard;
	/** Sends on the socket while it is ready. */
	private live: ((msg: Obj) => void) | null = null;
	/** Decisions on a change of pins made while no socket was ready, sent after the next `ready`. */
	private undelivered: Obj[] = [];
	/** Reports that a session is no longer served here, while the socket speaks protocol 2 or later. */
	private expire: ((sessionId: string) => void) | null = null;
	/** Sessions already reported with `session.expired`. */
	private expired = new Set<string>();
	/** Its origin server, while its sealed origin is on (§12.4); its sessions outlast a reconnect. */
	private readonly originServer: OriginServer | null = null;
	/** The streams of its own origin on the socket that is ready. */
	private originStreams: OriginStreams | null = null;
	/** Its own origin, once a gateway that took `sealed-origin` named the label it keeps (§12.1). */
	private machineOrigin: { label: string; domain: string } | null = null;

	constructor(private opts: ConnectorOptions) {
		this.random = opts.random ?? Math.random;
		this.guard = new SessionGuard({
			origin: new URL(opts.gateway).origin,
			pins: opts.pins,
			propose: (p) =>
				opts.events.proposed?.(p) ?? Promise.reject(new Error('there is nowhere to keep it')),
			log: (line) => this.log(`This machine ${line}`),
			now: opts.now
		});
		if (opts.sealedOrigin) {
			this.originServer = new OriginServer({
				targets: opts.targets,
				pins: () => this.guard.passkeys,
				gateway: new URL(opts.gateway).origin,
				onRelayed: (r) => opts.events.relayed?.(r),
				log: (line) => this.log(`This machine ${line}`),
				now: opts.now
			});
		}
	}

	/** Its app origin (§12.1), while it serves one: `https://<label>.m.<GATEWAY host>`. */
	get appOrigin(): string | null {
		return this.machineOrigin && `https://${this.machineOrigin.label}.${this.machineOrigin.domain}`;
	}

	/** Its sealed origin is on (§12.7): it refuses the plaintext relay whatever the gateway says. */
	private get sealed(): boolean {
		return !!this.opts.sealedOrigin;
	}

	start(): void {
		this.stopped = false;
		// Streams of a session past its limits end too, not only new ones (§6.6).
		if (this.sweeper) clearInterval(this.sweeper);
		this.sweeper = setInterval(() => {
			for (const id of this.guard.sweep()) {
				this.relay?.endSession(id, 'This session is past its limits; open the machine again.');
				this.expire?.(id);
			}
		}, this.opts.sweepMs ?? SWEEP_MS);
		this.sweeper.unref?.();
		this.connect();
	}

	/** Close the socket and stop reconnecting. */
	stop(reason: string | null = null): void {
		if (this.stopped) return;
		this.stopped = true;
		if (this.retry) clearTimeout(this.retry);
		if (this.sweeper) clearInterval(this.sweeper);
		this.retry = this.sweeper = null;
		this.teardown();
		// Machine sessions end when the connector stops (§12.5): turned off here, re-paired or revoked.
		this.originServer?.close();
		const ws = this.ws;
		this.ws = null;
		if (ws) {
			try {
				ws.close(1000);
			} catch {
				ws.terminate();
			}
			setTimeout(() => ws.terminate(), 2000).unref?.();
		}
		this.set('stopped', reason);
	}

	private set(state: ConnectorState, reason: string | null): void {
		this.state = state;
		this.opts.events.state(state, reason);
	}

	private log(line: string): void {
		this.opts.events.log?.(line);
	}

	/**
	 * The captain decided, here, on the pending change of pins `ref` (§6.6),
	 * already applied to the guard. The gateway is told with `pins.decided`,
	 * naming the pins after the decision; now, or after the next `ready` when
	 * no socket is ready.
	 */
	decide(d: { ref: string; approved: boolean; reason: string | null }): void {
		const msg: Obj = {
			t: 'pins.decided',
			ref: d.ref,
			approved: d.approved,
			...(d.approved ? {} : { reason: d.reason ?? 'rejected' }),
			pins: this.guard.credentials
		};
		if (this.live) return this.live(msg);
		this.undelivered.push(msg);
		while (this.undelivered.length > 8) this.undelivered.shift();
	}

	private teardown(): void {
		this.live = null;
		this.expire = null;
		if (this.watchdog) clearTimeout(this.watchdog);
		if (this.stable) clearTimeout(this.stable);
		this.watchdog = this.stable = null;
		this.relay?.closeAll();
		this.relay = null;
		this.originStreams?.closeAll();
		this.originStreams = null;
		this.machineOrigin = null;
		this.opts.sealedOrigin?.disconnected();
	}

	/**
	 * §12.1, §12.2, §12.7: the origin a gateway that took `sealed-origin` names
	 * in `ready`. The first label is kept and any other refused; the
	 * certificate is asked for, or renewed, over this socket. Returns why this
	 * machine serves nothing on this connection, or null once it serves its
	 * origin.
	 */
	private takeOrigin(msg: Obj, agreed: number, send: (m: Obj) => void): string | null {
		const certificate = this.opts.sealedOrigin!;
		const given = isObj(msg.origin) ? msg.origin : {};
		const features = Array.isArray(msg.features) ? msg.features : [];
		if (
			agreed < SEALED_PROTOCOL ||
			!features.includes('sealed-origin') ||
			typeof given.label !== 'string' ||
			typeof given.domain !== 'string'
		) {
			return 'This gateway does not support sealed origins, so this machine, which serves only its own origin, serves nothing through it.';
		}
		const { key, deviceId } = this.opts;
		const why = certificate.ready(
			{ label: given.label, domain: given.domain },
			new URL(this.opts.gateway).hostname,
			{ sign: (csr) => certRequestSig(key, deviceId, csr), send }
		);
		if (why) return `This machine serves nothing through this gateway: ${why}.`;
		this.machineOrigin = certificate.serving();
		this.log(`This machine serves its own origin, ${this.appOrigin}.`);
		return null;
	}

	/** §12.3: why this machine won't take a `tls` stream for `host`, or null when it will. */
	private tlsRefusal(host: string): string | null {
		if (!this.machineOrigin) return 'this machine has no name from this gateway';
		if (!this.opts.targets.enabled()) return 'Wheelhouse Cloud is turned off on this machine';
		if (machineHost(host, this.machineOrigin.domain)?.label !== this.machineOrigin.label) {
			return 'not one of this machine’s names';
		}
		if (!this.opts.sealedOrigin?.current()) return 'this machine has no valid certificate yet';
		return null;
	}

	/** §12.4: terminate the browser's TLS on an accepted `tls` stream, with the certificate held now. */
	private serveOrigin(stream: Duplex, ip: string | null): void {
		const certificate = this.opts.sealedOrigin?.current();
		if (!certificate || !this.machineOrigin || !this.originServer) {
			throw new Error('this machine no longer holds a valid certificate');
		}
		this.originServer.serve(stream, { ip }, { ...this.machineOrigin, ...certificate });
	}

	private connect(): void {
		if (this.stopped) return;
		this.set('connecting', null);
		const speaks = this.sealed ? SEALED_PROTOCOL : PROTOCOL;
		const ws = new WebSocket(connectUrl(this.opts.gateway), {
			headers: { 'X-WHC-Protocol': String(speaks) },
			perMessageDeflate: false,
			handshakeTimeout: 15_000,
			maxPayload: DEFAULT_LIMITS.maxWsMessage + 5 + 1024,
			followRedirects: false
		});
		this.ws = ws;
		let limits: Limits = DEFAULT_LIMITS;
		let ready = false;
		/**
		 * Why this connection serves nothing: the machine has pins and the gateway
		 * negotiated a protocol that can't have sessions signed (§1). Sessions
		 * verified on an earlier connection are refused on it too.
		 */
		let downgraded: string | null = null;
		/** The gateway took the `fleet` feature in `ready` (§6.11): only then is `fleet.changed` heard. */
		let fleet = false;
		/** Why a sealed machine serves nothing on this connection (§12.7), or null while it serves its origin. */
		let unsealed: string | null = null;
		let heartbeatMs = 20_000;
		const mine = () => this.ws === ws;
		const send = (msg: Obj) => {
			if (mine() && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
		};
		// No frame at all for 3 heartbeats: the socket is dead (§4.1).
		const alive = (ms: number) => {
			if (this.watchdog) clearTimeout(this.watchdog);
			this.watchdog = setTimeout(() => {
				this.log('The gateway went quiet; reconnecting.');
				ws.terminate();
			}, ms);
			this.watchdog.unref?.();
		};
		let upgradeStatus: number | null = null;
		ws.on('unexpected-response', (req, res) => {
			upgradeStatus = res.statusCode ?? 0;
			res.resume();
			req.destroy();
			ws.emit('close', upgradeStatus === 426 ? 4426 : 1006, Buffer.alloc(0));
		});
		ws.on('open', () => alive(this.opts.helloMs ?? HELLO_MS));
		ws.on('message', (data: Buffer, isBinary: boolean) => {
			if (!mine()) return;
			this.opts.events.seen?.();
			alive(ready ? heartbeatMs * 3 : (this.opts.helloMs ?? HELLO_MS));
			if (isBinary) {
				const f = ready ? decodeFrame(data) : null;
				if (f && this.sealed) this.originStreams?.frame(f.kind, f.id, f.payload);
				else if (f) this.relay?.frame(f.kind, f.id, f.payload);
				return;
			}
			if (data.length > MAX_CONTROL_BYTES) return;
			let msg: unknown;
			try {
				msg = JSON.parse(data.toString('utf8'));
			} catch {
				return;
			}
			if (!isObj(msg) || typeof msg.t !== 'string') return;
			if (!ready) {
				if (msg.t === 'hello' && typeof msg.nonce === 'string') {
					const { key, deviceId } = this.opts;
					send({
						t: 'auth',
						protocol: speaks,
						deviceId,
						sig: connectSig(key, msg.nonce, deviceId),
						// Protocol 3 signs the version it announces and names an encryption key (§4, §11.1).
						...(this.sealed
							? {
									protocolSig: protocolSig(key, msg.nonce, deviceId, speaks),
									e2eKey: e2eKeyBinding(key, deviceId, this.opts.now?.())
								}
							: {}),
						agent: { name: 'wheelhouse', version: this.opts.version },
						features: [
							...(this.opts.events.fleetChanged ? ['fleet'] : []),
							...(this.sealed ? ['sealed-origin'] : [])
						],
						pins: this.guard.credentials
					});
				} else if (msg.t === 'ready') {
					ready = true;
					const agreed = typeof msg.protocol === 'number' ? Math.min(msg.protocol, speaks) : 1;
					if (typeof msg.heartbeatMs === 'number' && msg.heartbeatMs >= 1000) {
						heartbeatMs = msg.heartbeatMs;
					}
					limits = readLimits(msg.limits);
					fleet =
						!!this.opts.events.fleetChanged &&
						Array.isArray(msg.features) &&
						msg.features.includes('fleet');
					alive(heartbeatMs * 3);
					// No silent downgrade (§1): such a gateway can't have sessions signed, so each is refused.
					downgraded =
						this.guard.checks && agreed < 2
							? `This gateway speaks protocol ${agreed}, so it cannot have sessions signed with your passkey; this machine refuses every session it relays until the gateway is updated.`
							: null;
					this.relay = new Relay({
						limits,
						targets: this.opts.targets,
						send,
						sendFrame: (frame) => {
							if (mine() && ws.readyState === WebSocket.OPEN) ws.send(frame, { binary: true });
						},
						onRelayed: (r) => this.opts.events.relayed?.(r),
						sessionRefusal: (id) => (downgraded ? NOT_SIGNED_HERE : this.guard.refusal(id)),
						sessionRefused: (id) => this.expire?.(id)
					});
					if (this.sealed) {
						unsealed = this.takeOrigin(msg, agreed, send);
						this.originStreams = new OriginStreams({
							limits,
							send,
							sendFrame: (frame) => {
								if (mine() && ws.readyState === WebSocket.OPEN) ws.send(frame, { binary: true });
							},
							refusal: (host) => this.tlsRefusal(host),
							serve: (stream, info) => this.serveOrigin(stream, info.ip),
							log: (line) => this.log(`This machine ${line}`)
						});
					}
					this.stable = setTimeout(() => (this.attempt = 0), this.opts.stableMs ?? STABLE_MS);
					this.stable.unref?.();
					if (downgraded) this.log(downgraded);
					if (unsealed) this.log(unsealed);
					this.set('online', downgraded ?? unsealed);
					this.live = send;
					// A session this machine no longer serves (never verified, forgotten in a restart, or
					// past its limits) is reported once (§6.6), so the gateway ends it and the browser can
					// sign in again rather than be refused stream after stream. Older gateways have no such
					// message, and a downgraded one serves nothing at all.
					this.expire =
						agreed >= 2
							? (id) => {
									if (this.expired.has(id)) return;
									this.expired.add(id);
									while (this.expired.size > MAX_EXPIRED) {
										this.expired.delete(this.expired.values().next().value!);
									}
									send({ t: 'session.expired', sessionId: id });
								}
							: null;
					for (const m of this.undelivered.splice(0)) send(m);
				}
				return;
			}
			if (msg.t === 'ping') return send({ t: 'pong', ts: msg.ts });
			if (msg.t === 'pong') return;
			if (msg.t === 'fleet.changed') {
				const version = msg.version;
				if (fleet && typeof version === 'string' && version && version.length <= 128) {
					this.opts.events.fleetChanged?.(version);
				}
				return;
			}
			if (msg.t.startsWith('session.') || msg.t.startsWith('pins.')) {
				if (msg.t === 'session.end' && typeof msg.sessionId === 'string') {
					this.relay?.endSession(msg.sessionId, 'The relay session ended.');
				}
				if (downgraded && msg.t !== 'session.end') {
					const reply = this.guard.refuse(msg, NOT_SIGNED_HERE);
					if (reply) send(reply);
					return;
				}
				// Sealed, it signs nobody into the gateway's relay; the captain signs in on its own origin (§12.7).
				if (this.sealed && msg.t.startsWith('session.')) {
					const reply = this.guard.refuse(
						msg,
						this.appOrigin ? `${SEALED}, ${this.appOrigin}` : SEALED
					);
					if (reply) send(reply);
					return;
				}
				void this.guard.handle(msg).then(
					(reply) => reply && send(reply),
					(e: unknown) => this.log(`Could not answer ${msg.t}: ${(e as Error).message}`)
				);
				return;
			}
			if (this.sealed) {
				if (msg.t === 'cert.issued') return this.opts.sealedOrigin?.answer(msg);
				if (SEALED_REFUSED.has(msg.t) && typeof msg.id === 'number') {
					return send({ t: 'reset', id: msg.id, code: 'refused', message: SEALED });
				}
				return this.originStreams?.control(msg);
			}
			this.relay?.control(msg);
		});
		ws.on('error', (e) => {
			if (mine()) this.log(`Gateway connection error: ${e.message}`);
		});
		ws.on('close', (code: number) => {
			if (!mine()) return;
			this.ws = null;
			this.teardown();
			if (this.stopped) return;
			const action = closeAction(code);
			if (action.kind === 'stop') {
				this.stopped = true;
				if (action.forget) this.opts.events.revoked?.();
				this.set('stopped', action.reason);
				return;
			}
			if (action.note) this.log(`The gateway closed the connection: ${action.note}.`);
			const wait = Math.max(action.minDelayMs ?? 0, backoffMs(this.attempt, this.random));
			this.attempt = Math.min(this.attempt + 1, 16);
			const reason = upgradeStatus
				? `The gateway answered ${upgradeStatus}; trying again.`
				: ready
					? 'The connection dropped; reconnecting.'
					: 'Could not reach the gateway; trying again.';
			this.set('connecting', reason);
			this.retry = setTimeout(() => this.connect(), wait);
			this.retry.unref?.();
		});
	}
}

function readLimits(v: unknown): Limits {
	const out = { ...DEFAULT_LIMITS };
	if (!isObj(v)) return out;
	for (const k of Object.keys(out) as (keyof Limits)[]) {
		const n = v[k];
		if (typeof n === 'number' && Number.isInteger(n) && n > 0) out[k] = n;
	}
	return out;
}
