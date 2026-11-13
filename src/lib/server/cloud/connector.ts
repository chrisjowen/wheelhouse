import WebSocket from 'ws';
import { SessionGuard, type PinsProposal } from './guard';
import type { PinnedPasskey } from './passkeys';
import {
	backoffMs,
	closeAction,
	connectSig,
	decodeFrame,
	DEFAULT_LIMITS,
	MAX_CONTROL_BYTES,
	PROTOCOL,
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
	/** How often the streams of sessions past their 8 hours are looked for and ended. */
	sweepMs?: number;
}

const HELLO_MS = 15_000;
const STABLE_MS = 60_000;
/** How often the streams of sessions past their 8 hours are looked for and ended. */
const SWEEP_MS = 60_000;
/** Why a gateway that negotiated protocol 1 gets nothing from a machine with pins. */
const NOT_SIGNED_HERE =
	'this gateway cannot have sessions signed, so this machine with pinned passkeys serves nothing through it';

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
	}

	start(): void {
		this.stopped = false;
		// Streams of a session served for its 8 hours end too, not only new ones (§6.6).
		if (this.sweeper) clearInterval(this.sweeper);
		this.sweeper = setInterval(() => {
			for (const id of this.guard.sweep()) {
				this.relay?.endSession(id, 'This session was signed more than 8 hours ago.');
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
	 * The captain decided, here, on the pending change of pins `ref` (§6.6):
	 * an approved one's passkeys are trusted from now on. The gateway is told
	 * with `pins.decided`, naming the pins after the decision; now, or after
	 * the next `ready` when no socket is ready.
	 */
	decide(d: {
		ref: string;
		approved: boolean;
		reason: string | null;
		pins?: PinnedPasskey[] | null;
	}): void {
		if (d.approved && d.pins) this.guard.repin(d.pins);
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
		if (this.watchdog) clearTimeout(this.watchdog);
		if (this.stable) clearTimeout(this.stable);
		this.watchdog = this.stable = null;
		this.relay?.closeAll();
		this.relay = null;
	}

	private connect(): void {
		if (this.stopped) return;
		this.set('connecting', null);
		const ws = new WebSocket(connectUrl(this.opts.gateway), {
			headers: { 'X-WHC-Protocol': String(PROTOCOL) },
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
				if (f) this.relay?.frame(f.kind, f.id, f.payload);
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
					send({
						t: 'auth',
						protocol: PROTOCOL,
						deviceId: this.opts.deviceId,
						sig: connectSig(this.opts.key, msg.nonce, this.opts.deviceId),
						agent: { name: 'wheelhouse', version: this.opts.version },
						features: [],
						pins: this.guard.credentials
					});
				} else if (msg.t === 'ready') {
					ready = true;
					const agreed = typeof msg.protocol === 'number' ? Math.min(msg.protocol, PROTOCOL) : 1;
					if (typeof msg.heartbeatMs === 'number' && msg.heartbeatMs >= 1000) {
						heartbeatMs = msg.heartbeatMs;
					}
					limits = readLimits(msg.limits);
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
						sessionRefusal: (id) => (downgraded ? NOT_SIGNED_HERE : this.guard.refusal(id))
					});
					this.stable = setTimeout(() => (this.attempt = 0), this.opts.stableMs ?? STABLE_MS);
					this.stable.unref?.();
					if (downgraded) this.log(downgraded);
					this.set('online', downgraded);
					this.live = send;
					for (const m of this.undelivered.splice(0)) send(m);
				}
				return;
			}
			if (msg.t === 'ping') return send({ t: 'pong', ts: msg.ts });
			if (msg.t === 'pong') return;
			if (msg.t.startsWith('session.') || msg.t.startsWith('pins.')) {
				if (msg.t === 'session.end' && typeof msg.sessionId === 'string') {
					this.relay?.endSession(msg.sessionId, 'The relay session ended.');
				}
				if (downgraded && msg.t !== 'session.end') {
					const reply = this.guard.refuse(msg, NOT_SIGNED_HERE);
					if (reply) send(reply);
					return;
				}
				void this.guard.handle(msg).then(
					(reply) => reply && send(reply),
					(e: unknown) => this.log(`Could not answer ${msg.t}: ${(e as Error).message}`)
				);
				return;
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
