import WebSocket from 'ws';
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
 * device is unknown, removed or replaced, or speaks a newer protocol.
 */

export type ConnectorState = 'connecting' | 'online' | 'stopped';

export interface ConnectorEvents {
	state: (state: ConnectorState, reason: string | null) => void;
	/** Any frame from the gateway (heartbeats included). */
	seen?: () => void;
	relayed?: (relay: RelayContext) => void;
	/** The gateway removed this device (4403): its key must be deleted. */
	revoked?: () => void;
	log?: (line: string) => void;
}

export interface ConnectorOptions {
	gateway: string;
	deviceId: string;
	key: DeviceKey;
	version: string;
	targets: RelayTargets;
	events: ConnectorEvents;
	random?: () => number;
	/** No `hello` from the gateway in this long after the socket opens: start again. */
	helloMs?: number;
	/** How long a socket must stay ready before backoff starts over. */
	stableMs?: number;
}

const HELLO_MS = 15_000;
const STABLE_MS = 60_000;

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
	private stopped = false;
	private readonly random: () => number;

	constructor(private opts: ConnectorOptions) {
		this.random = opts.random ?? Math.random;
	}

	start(): void {
		this.stopped = false;
		this.connect();
	}

	/** Close the socket and stop reconnecting. */
	stop(reason: string | null = null): void {
		if (this.stopped) return;
		this.stopped = true;
		if (this.retry) clearTimeout(this.retry);
		this.retry = null;
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

	private teardown(): void {
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
					if (typeof msg.protocol === 'number' && msg.protocol < PROTOCOL) {
						this.log(
							`The gateway speaks protocol ${msg.protocol}; this Wheelhouse speaks ${PROTOCOL}.`
						);
					}
					send({
						t: 'auth',
						protocol: PROTOCOL,
						deviceId: this.opts.deviceId,
						sig: connectSig(this.opts.key, msg.nonce, this.opts.deviceId),
						agent: { name: 'wheelhouse', version: this.opts.version },
						features: []
					});
				} else if (msg.t === 'ready') {
					ready = true;
					if (typeof msg.heartbeatMs === 'number' && msg.heartbeatMs >= 1000) {
						heartbeatMs = msg.heartbeatMs;
					}
					limits = readLimits(msg.limits);
					alive(heartbeatMs * 3);
					this.relay = new Relay({
						limits,
						targets: this.opts.targets,
						send,
						sendFrame: (frame) => {
							if (mine() && ws.readyState === WebSocket.OPEN) ws.send(frame, { binary: true });
						},
						onRelayed: (r) => this.opts.events.relayed?.(r)
					});
					this.stable = setTimeout(() => (this.attempt = 0), this.opts.stableMs ?? STABLE_MS);
					this.stable.unref?.();
					this.set('online', null);
				}
				return;
			}
			if (msg.t === 'ping') return send({ t: 'pong', ts: msg.ts });
			if (msg.t === 'pong') return;
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
