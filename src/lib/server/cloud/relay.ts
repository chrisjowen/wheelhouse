import http, { type ClientRequest, type IncomingMessage } from 'node:http';
import WebSocket from 'ws';
import {
	encodeFrame,
	FRAME_HTTP,
	FRAME_WS_BINARY,
	FRAME_WS_TEXT,
	HOP_BY_HOP,
	isRestartPath,
	MAX_HEADER_BYTES,
	MAX_HEADER_ENTRIES,
	type Limits
} from './protocol';

/**
 * The streams one gateway socket carries (§5-§6 of the protocol): each `req`
 * becomes a request to this machine's Wheelhouse or to a preview port it
 * reports, each `ws` a WebSocket to it, with bytes flowing back under the
 * per-stream credit window. The connector is the last line of defence on the
 * machine, so it refuses what Wheelhouse does not offer: a port that is not a
 * preview, Wheelhouse's restart, anything while the cloud is off here.
 */

/** §6.2: who a relayed request is for. */
export interface RelayContext {
	sessionId: string;
	user: { id: string; name: string };
	origin: string;
	previewOrigin: string;
}

export interface RelayTargets {
	/** The port the local Wheelhouse listens on (127.0.0.1). */
	appPort(): number;
	/** The ports Wheelhouse reports as previews now (task previews, forwarded second-mate previews). */
	previewPorts(): Promise<Set<number>>;
	/** Whether the cloud is still turned on here. */
	enabled(): boolean;
}

export interface RelayOptions {
	send: (msg: Record<string, unknown>) => void;
	sendFrame: (frame: Buffer) => void;
	limits: Limits;
	targets: RelayTargets;
	/** A request or socket was relayed for this session. */
	onRelayed?: (relay: RelayContext) => void;
	/** No data either way on an answered HTTP stream for this long resets it (§6.3). */
	idleMs?: number;
	/** How long the local server gets to accept a WebSocket. */
	wsHandshakeMs?: number;
}

type Pair = [string, string];

interface Flow {
	/** Bytes sent to the gateway that it has not credited back yet. */
	out: number;
	/** Bytes the gateway sent that are not credited back yet, and those already passed on. */
	in: number;
	passed: number;
}

interface HttpStream {
	kind: 'http';
	id: number;
	flow: Flow;
	req: ClientRequest;
	res: IncomingMessage | null;
	/** Response body frames waiting for credit, and whether the local answer has ended. */
	queue: Buffer[];
	ended: boolean;
	received: number;
	idle: ReturnType<typeof setTimeout> | null;
}

interface WsStream {
	kind: 'ws';
	id: number;
	flow: Flow;
	ws: WebSocket;
	accepted: boolean;
	paused: boolean;
}

type Stream = HttpStream | WsStream;

const CREDIT_BATCH = 64 * 1024;
const IDLE_MS = 5 * 60_000;
const WS_HANDSHAKE_MS = 12_000;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
/** A value Node will put in a header: no control characters. */
const headerSafe = (s: string) => {
	for (let i = 0; i < s.length; i++) {
		const c = s.charCodeAt(i);
		if ((c < 0x20 && c !== 0x09) || c === 0x7f) return false;
	}
	return true;
};

function parseRelay(v: unknown): RelayContext | null {
	if (!isObj(v) || !isObj(v.user)) return null;
	const { sessionId, origin, previewOrigin } = v;
	const { id, name } = v.user;
	const all = [sessionId, origin, previewOrigin, id];
	if (!all.every((s) => typeof s === 'string' && s.length <= 512 && headerSafe(s))) return null;
	return {
		sessionId: sessionId as string,
		user: { id: id as string, name: typeof name === 'string' ? name : '' },
		origin: origin as string,
		previewOrigin: previewOrigin as string
	};
}

function parseHeaders(v: unknown): Pair[] | null {
	if (!Array.isArray(v) || v.length > MAX_HEADER_ENTRIES) return null;
	let bytes = 0;
	const out: Pair[] = [];
	for (const h of v) {
		if (!Array.isArray(h) || h.length !== 2) return null;
		const [name, value] = h;
		if (typeof name !== 'string' || typeof value !== 'string') return null;
		if (!/^[!#$%&'*+.^_`|~0-9a-z-]+$/i.test(name) || !headerSafe(value)) return null;
		bytes += name.length + value.length + 4;
		out.push([name.toLowerCase(), value]);
	}
	return bytes <= MAX_HEADER_BYTES ? out : null;
}

export class Relay {
	private streams = new Map<number, Stream>();
	/**
	 * Streams still being admitted (the preview ports are looked up first),
	 * with the body frames and `req.end` that arrived meanwhile; a reset
	 * meanwhile removes the entry, and the stream is then never opened.
	 */
	private early = new Map<number, { frames: [number, Buffer][]; bytes: number; end: boolean }>();
	private lastId = 0;
	private closed = false;
	private readonly idleMs: number;

	constructor(private opts: RelayOptions) {
		this.idleMs = opts.idleMs ?? IDLE_MS;
	}

	get open(): number {
		return this.streams.size;
	}

	/** A control message about a stream. */
	control(msg: Obj): void {
		if (this.closed) return;
		const id = typeof msg.id === 'number' ? msg.id : -1;
		switch (msg.t) {
			case 'req':
			case 'ws':
				if (this.streams.has(id) || this.early.has(id)) break;
				this.early.set(id, { frames: [], bytes: 0, end: false });
				void (msg.t === 'req' ? this.request(id, msg) : this.socket(id, msg));
				break;
			case 'req.end': {
				const e = this.early.get(id);
				if (e) e.end = true;
				const s = this.streams.get(id);
				if (s?.kind === 'http') s.req.end();
				break;
			}
			case 'credit': {
				const s = this.streams.get(id);
				if (s && typeof msg.bytes === 'number' && msg.bytes > 0) this.credited(s, msg.bytes);
				break;
			}
			case 'reset':
				this.early.delete(id);
				this.drop(id);
				break;
			case 'ws.close': {
				const s = this.streams.get(id);
				if (s?.kind !== 'ws') break;
				this.streams.delete(id);
				const code = typeof msg.code === 'number' ? msg.code : 1000;
				const reason = typeof msg.reason === 'string' ? msg.reason.slice(0, 123) : '';
				try {
					s.ws.close(closable(code), reason);
				} catch {
					s.ws.terminate();
				}
				break;
			}
		}
	}

	/** A binary frame: request body, or a WebSocket message for the local side. */
	frame(kind: number, id: number, payload: Buffer): void {
		const { window, maxFrame, maxWsMessage, maxBody } = this.opts.limits;
		const e = this.early.get(id);
		if (e) {
			// Kept until the stream opens; the gateway's window bounds how much that is.
			if (e.bytes >= window) {
				this.early.delete(id);
				return this.reset(id, 'protocol', 'The credit window was exceeded.', { force: true });
			}
			e.bytes += payload.length;
			e.frames.push([kind, payload]);
			return;
		}
		const s = this.streams.get(id);
		if (!s) return;
		// One frame may take the window over, but nothing may be sent while it is full.
		if (s.flow.in >= window) return this.reset(s.id, 'protocol', 'The credit window was exceeded.');
		s.flow.in += payload.length;
		if (s.kind === 'http') {
			if (kind !== FRAME_HTTP || payload.length > maxFrame) {
				return this.reset(s.id, 'protocol', 'Unexpected frame for an HTTP stream.');
			}
			s.received += payload.length;
			if (s.received > maxBody) return this.reset(s.id, 'too_large');
			this.touch(s);
			s.req.write(payload, () => this.passed(s, payload.length));
			return;
		}
		if ((kind !== FRAME_WS_TEXT && kind !== FRAME_WS_BINARY) || !s.accepted) {
			return this.reset(s.id, 'protocol', 'Unexpected frame for a WebSocket stream.');
		}
		if (payload.length > maxWsMessage) return this.reset(s.id, 'too_large');
		s.ws.send(payload, { binary: kind === FRAME_WS_BINARY }, () => this.passed(s, payload.length));
	}

	/** The device socket is gone: every stream on it ends (§7). */
	closeAll(): void {
		this.closed = true;
		this.early.clear();
		for (const id of [...this.streams.keys()]) this.drop(id);
	}

	/** Open a stream admitted meanwhile, with what arrived for it; false when it was reset first. */
	private opened(s: Stream): boolean {
		const e = this.early.get(s.id);
		if (!e) {
			this.drop(s.id);
			return false;
		}
		this.early.delete(s.id);
		for (const [kind, payload] of e.frames) this.frame(kind, s.id, payload);
		if (e.end && s.kind === 'http' && this.streams.get(s.id) === s) s.req.end();
		return true;
	}

	private passed(s: Stream, n: number): void {
		if (this.streams.get(s.id) !== s) return;
		s.flow.passed += n;
		const drained = s.kind === 'http' ? s.req.writableLength === 0 : s.ws.bufferedAmount === 0;
		// Batched, but never so late that a small window stalls (§6.1).
		const batch = Math.min(CREDIT_BATCH, Math.floor(this.opts.limits.window / 2));
		if (s.flow.passed >= batch || drained) {
			this.opts.send({ t: 'credit', id: s.id, bytes: s.flow.passed });
			s.flow.in -= s.flow.passed;
			s.flow.passed = 0;
		}
	}

	private credited(s: Stream, n: number): void {
		s.flow.out = Math.max(0, s.flow.out - n);
		if (s.kind === 'http') return this.flush(s);
		if (s.flow.out >= this.opts.limits.window) return;
		if (s.paused) {
			s.paused = false;
			s.ws.resume();
		}
	}

	/** Send one WebSocket message to the gateway; true while the stream's window still has room. */
	private sendMessage(s: WsStream, kind: number, data: Buffer): boolean {
		this.opts.sendFrame(encodeFrame(kind, s.id, data));
		s.flow.out += data.length;
		return s.flow.out < this.opts.limits.window;
	}

	/**
	 * Send queued response body while the window has room, a frame of at most
	 * maxFrame at a time (§6.1); the local answer is paused while any waits, and
	 * `res.end` follows the last of it.
	 */
	private flush(s: HttpStream): void {
		const { maxFrame, window } = this.opts.limits;
		while (s.queue.length && s.flow.out < window) {
			const head = s.queue[0];
			const piece = head.subarray(0, maxFrame);
			if (piece.length === head.length) s.queue.shift();
			else s.queue[0] = head.subarray(maxFrame);
			this.opts.sendFrame(encodeFrame(FRAME_HTTP, s.id, piece));
			s.flow.out += piece.length;
		}
		if (s.queue.length) s.res?.pause();
		else if (s.ended) this.finish(s);
		else s.res?.resume();
	}

	private reset(id: number, code: string, message?: string, extra: Obj = {}): void {
		const was = this.streams.has(id);
		this.drop(id);
		if (was || extra.force) {
			const { force: _, ...rest } = extra;
			void _;
			this.opts.send({ t: 'reset', id, code, ...(message ? { message } : {}), ...rest });
		}
	}

	/** Forget a stream and abort its local side, sending nothing. */
	private drop(id: number): void {
		const s = this.streams.get(id);
		if (!s) return;
		this.streams.delete(id);
		if (s.kind === 'http') {
			if (s.idle) clearTimeout(s.idle);
			s.req.destroy();
			s.res?.destroy();
		} else s.ws.terminate();
	}

	private touch(s: HttpStream): void {
		if (!s.res) return;
		if (s.idle) clearTimeout(s.idle);
		s.idle = setTimeout(() => this.reset(s.id, 'timeout'), this.idleMs);
		s.idle.unref?.();
	}

	/**
	 * What the request may reach, or the reset that refuses it (§6.4): the
	 * stream id is new, the target is Wheelhouse or one of its previews, the path
	 * is an absolute path that is not the restart, and the cloud is on here.
	 */
	private async admit(
		id: number,
		msg: Obj
	): Promise<
		| { ok: true; port: number; host: string; path: string; headers: Pair[]; relay: RelayContext }
		| { ok: false; code: string; message?: string }
	> {
		if (!Number.isInteger(id) || id <= this.lastId || id > 0xffffffff) {
			return { ok: false, code: 'protocol', message: 'Stream ids must increase.' };
		}
		this.lastId = id;
		if (this.streams.size >= this.opts.limits.maxStreams) return { ok: false, code: 'limit' };
		const relay = parseRelay(msg.relay);
		const headers = parseHeaders(msg.headers);
		const path = msg.path;
		if (
			!relay ||
			!headers ||
			typeof path !== 'string' ||
			!path.startsWith('/') ||
			path.length > 8192 ||
			!headerSafe(path) ||
			path.includes(' ')
		) {
			return { ok: false, code: 'protocol', message: 'The request is malformed.' };
		}
		if (!this.opts.targets.enabled()) {
			return {
				ok: false,
				code: 'refused',
				message: 'Wheelhouse Cloud is turned off on this machine.'
			};
		}
		if (isRestartPath(path)) {
			return {
				ok: false,
				code: 'refused',
				message: 'Wheelhouse cannot be restarted through the cloud.'
			};
		}
		const target = isObj(msg.target) ? msg.target : {};
		const app = this.opts.targets.appPort();
		if (target.kind === 'app') {
			return { ok: true, port: app, host: '127.0.0.1', path, headers, relay };
		}
		const port = target.port;
		if (
			target.kind !== 'port' ||
			typeof port !== 'number' ||
			!Number.isInteger(port) ||
			port < 1 ||
			port > 65535
		) {
			return { ok: false, code: 'protocol', message: 'Unknown target.' };
		}
		if (port === app || !(await this.opts.targets.previewPorts()).has(port)) {
			return { ok: false, code: 'refused', message: 'That port is not a Wheelhouse preview.' };
		}
		return { ok: true, port, host: 'localhost', path, headers, relay };
	}

	/** §6.3: the headers for the local request. */
	private localHeaders(
		a: { port: number; host: string; headers: Pair[]; relay: RelayContext },
		originChecked: boolean,
		ws: boolean
	): Record<string, string | string[]> {
		const out: Record<string, string | string[]> = {};
		for (const [name, value] of a.headers) {
			if (HOP_BY_HOP.has(name) || name === 'host' || name === 'origin') continue;
			if (name.startsWith('x-wheelhouse-remote')) continue;
			if (ws && name.startsWith('sec-websocket-')) continue;
			const had = out[name];
			if (had === undefined) out[name] = value;
			else if (name === 'cookie') out[name] = `${had as string}; ${value}`;
			else out[name] = Array.isArray(had) ? [...had, value] : [had, value];
		}
		const local = `${a.host}:${a.port}`;
		out.host = local;
		if (originChecked) out.origin = `http://${local}`;
		out['x-wheelhouse-remote'] = '1';
		out['x-wheelhouse-remote-user'] = a.relay.user.id;
		out['x-wheelhouse-remote-session'] = a.relay.sessionId;
		out['x-wheelhouse-remote-origin'] = a.relay.origin;
		out['x-wheelhouse-remote-preview'] = a.relay.previewOrigin;
		return out;
	}

	private async request(id: number, msg: Obj): Promise<void> {
		const a = await this.admit(id, msg);
		if (this.closed || !this.early.has(id)) return;
		const method =
			typeof msg.method === 'string' && /^[A-Z]{1,20}$/.test(msg.method) ? msg.method : null;
		if (!a.ok || !method) {
			this.early.delete(id);
			if (!a.ok) return this.reset(id, a.code, a.message, { force: true });
			return this.reset(id, 'protocol', 'The method is malformed.', { force: true });
		}
		this.opts.onRelayed?.(a.relay);
		const req = http.request({
			host: a.host,
			port: a.port,
			method,
			path: a.path,
			headers: this.localHeaders(a, msg.originChecked === true, false),
			setHost: false
		});
		const s: HttpStream = {
			kind: 'http',
			id,
			flow: { out: 0, in: 0, passed: 0 },
			req,
			res: null,
			queue: [],
			ended: false,
			received: 0,
			idle: null
		};
		this.streams.set(id, s);
		req.on('error', (e: NodeJS.ErrnoException) => {
			if (this.streams.get(id) !== s) return;
			const refused =
				!s.res &&
				['ECONNREFUSED', 'ECONNRESET', 'EHOSTUNREACH', 'ENOTFOUND'].includes(e.code ?? '');
			this.reset(id, refused ? 'unreachable' : 'internal');
		});
		req.on('response', (res) => this.respond(s, method, res, a));
		if (msg.body !== true) req.end();
		this.opened(s);
	}

	private respond(
		s: HttpStream,
		method: string,
		res: IncomingMessage,
		a: { port: number; host: string }
	): void {
		if (this.streams.get(s.id) !== s) return void res.destroy();
		s.res = res;
		const headers: Pair[] = [];
		let bytes = 0;
		const raw = res.rawHeaders;
		for (let i = 0; i + 1 < raw.length; i += 2) {
			const name = raw[i].toLowerCase();
			if (HOP_BY_HOP.has(name)) continue;
			let value = raw[i + 1];
			if (name === 'location') value = relativeLocation(value, a.host, a.port);
			bytes += name.length + value.length + 4;
			headers.push([name, value]);
		}
		if (headers.length > MAX_HEADER_ENTRIES || bytes > MAX_HEADER_BYTES) {
			return this.reset(s.id, 'protocol', 'The local answer’s headers are too large.');
		}
		this.opts.send({ t: 'res', id: s.id, status: res.statusCode ?? 502, headers });
		this.touch(s);
		const status = res.statusCode ?? 0;
		if (method === 'HEAD' || status === 204 || status === 304) {
			res.resume();
			this.finish(s);
			return;
		}
		res.on('data', (chunk: Buffer) => {
			if (this.streams.get(s.id) !== s) return;
			this.touch(s);
			s.queue.push(chunk);
			this.flush(s);
		});
		res.on('end', () => {
			if (this.streams.get(s.id) !== s) return;
			s.ended = true;
			this.flush(s);
		});
		res.on('error', () => {
			if (this.streams.get(s.id) === s) this.reset(s.id, 'internal');
		});
	}

	private finish(s: HttpStream): void {
		if (this.streams.get(s.id) !== s) return;
		this.opts.send({ t: 'res.end', id: s.id });
		this.streams.delete(s.id);
		if (s.idle) clearTimeout(s.idle);
		// Answered before the whole body arrived: the rest of it is not wanted.
		if (!s.req.writableFinished) s.req.destroy();
	}

	private async socket(id: number, msg: Obj): Promise<void> {
		const a = await this.admit(id, msg);
		if (this.closed || !this.early.has(id)) return;
		if (!a.ok) {
			this.early.delete(id);
			return this.reset(id, a.code, a.message, { force: true });
		}
		const protocols = Array.isArray(msg.protocols)
			? msg.protocols.filter(
					(p): p is string => typeof p === 'string' && /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(p)
				)
			: [];
		this.opts.onRelayed?.(a.relay);
		const headers = this.localHeaders(a, msg.originChecked === true, true);
		const ws = new WebSocket(`ws://${a.host}:${a.port}${a.path}`, protocols, {
			headers,
			perMessageDeflate: false,
			handshakeTimeout: this.opts.wsHandshakeMs ?? WS_HANDSHAKE_MS,
			maxPayload: this.opts.limits.maxWsMessage,
			followRedirects: false
		});
		const s: WsStream = {
			kind: 'ws',
			id,
			flow: { out: 0, in: 0, passed: 0 },
			ws,
			accepted: false,
			paused: false
		};
		this.streams.set(id, s);
		if (!this.opened(s)) return;
		const mine = () => this.streams.get(id) === s;
		ws.on('unexpected-response', (req, res) => {
			const status = res.statusCode ?? 502;
			res.resume();
			req.destroy();
			if (mine())
				this.reset(id, status === 403 || status === 401 ? 'refused' : 'unreachable', undefined, {
					status
				});
		});
		ws.on('open', () => {
			if (!mine()) return void ws.terminate();
			s.accepted = true;
			this.opts.send({ t: 'ws.accept', id, protocol: ws.protocol || null });
		});
		ws.on('message', (data: Buffer | Buffer[] | ArrayBuffer, isBinary: boolean) => {
			if (!mine()) return;
			const buf = Buffer.isBuffer(data)
				? data
				: Array.isArray(data)
					? Buffer.concat(data)
					: Buffer.from(data);
			if (buf.length > this.opts.limits.maxWsMessage) return this.reset(id, 'too_large');
			if (!this.sendMessage(s, isBinary ? FRAME_WS_BINARY : FRAME_WS_TEXT, buf) && !s.paused) {
				s.paused = true;
				ws.pause();
			}
		});
		ws.on('error', (e) => {
			if (!mine()) return;
			if (s.accepted) return this.reset(id, 'internal');
			this.reset(id, /timed out/i.test(e.message) ? 'timeout' : 'unreachable');
		});
		ws.on('close', (code, reason) => {
			if (!mine()) return;
			this.streams.delete(id);
			if (!s.accepted) return this.opts.send({ t: 'reset', id, code: 'unreachable' });
			const sent = code === 1005 ? 1000 : code === 1006 ? 1011 : code;
			this.opts.send({
				t: 'ws.close',
				id,
				code: sent,
				reason: reason.toString('utf8').slice(0, 123)
			});
		});
	}
}

/** A close code the local side can be closed with: 1000, 1001-1014 that may be sent, or 3000-4999. */
function closable(code: number): number {
	if (code === 1000 || (code >= 3000 && code <= 4999)) return code;
	if (code >= 1001 && code <= 1014 && ![1004, 1005, 1006].includes(code)) return code;
	return 1000;
}

/** §6.3: a redirect to the stream's own local target stays on the relay host, path-relative. */
export function relativeLocation(value: string, host: string, port: number): string {
	const u = URL.parse(value);
	if (!u || u.protocol !== 'http:') return value;
	const same =
		u.port === String(port) &&
		(u.hostname === host || u.hostname === '127.0.0.1' || u.hostname === 'localhost');
	return same ? `${u.pathname}${u.search}${u.hash}` : value;
}
