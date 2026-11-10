import { createHash, createPublicKey, randomBytes, randomUUID, verify } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';

/**
 * A Wheelhouse Cloud gateway for tests, speaking the connector protocol
 * (wheelhouse-cloud docs/protocol.md, version 1) on loopback: pairing that a
 * test approves, the device socket with a real signature check, and streams
 * the test opens as if a browser had asked. It checks what a real gateway
 * would (the credit window, frames for unknown streams) and records it.
 */

const SPKI = Buffer.from('302a300506032b6570032100', 'hex');
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function fingerprintOf(publicKey: string): string {
	const d = createHash('sha256')
		.update(Buffer.from(publicKey, 'base64url'))
		.digest()
		.subarray(0, 10);
	let bits = 0;
	let value = 0;
	let out = '';
	for (const b of d) {
		value = (value << 8) | b;
		bits += 8;
		while (bits >= 5) {
			out += BASE32[(value >>> (bits - 5)) & 31];
			bits -= 5;
		}
	}
	return out.match(/.{4}/g)!.join('-');
}

function verified(publicKey: string, message: string, sig: string): boolean {
	try {
		const key = createPublicKey({
			key: Buffer.concat([SPKI, Buffer.from(publicKey, 'base64url')]),
			format: 'der',
			type: 'spki'
		});
		return verify(null, Buffer.from(message, 'utf8'), key, Buffer.from(sig, 'base64url'));
	} catch {
		return false;
	}
}

export interface Pairing {
	id: string;
	publicKey: string;
	name: string;
	platform: string;
	code: string;
	status: 'pending' | 'approved' | 'denied' | 'expired';
	deviceId: string | null;
}

export const LIMITS = {
	maxStreams: 256,
	window: 64 * 1024,
	maxFrame: 16 * 1024,
	maxBody: 1024 * 1024,
	maxWsMessage: 256 * 1024
};

export const RELAY = {
	sessionId: '7b0c1d2e-0000-4000-8000-000000000001',
	user: { id: 'u-1', name: 'Captain' },
	origin: 'https://abcdefghijklmnopqrst.cloud.test',
	previewOrigin: 'https://abcdefghijklmnopqrst-p{port}.cloud.test'
};

export interface HttpAnswer {
	status: number;
	headers: [string, string][];
	body: Buffer;
	/** The most payload bytes ever outstanding (sent, not credited) on the stream. */
	maxOutstanding: number;
	reset: { code: string; message?: string; status?: number } | null;
}

export interface WsStream {
	accepted: { protocol: string | null } | null;
	reset: { code: string; status?: number } | null;
	messages: { binary: boolean; data: Buffer }[];
	closed: { code: number; reason: string } | null;
	send(data: string | Buffer): void;
	close(code?: number, reason?: string): void;
	/** Resolves once accepted or reset. */
	ready: Promise<void>;
	next(n?: number): Promise<void>;
}

export class DeviceSocket {
	private nextId = 1;
	private http = new Map<number, { answer: HttpAnswer; outstanding: number; done: () => void }>();
	private ws = new Map<number, WsStream & { notify: () => void }>();
	readonly controls: Record<string, unknown>[] = [];
	closedWith: number | null = null;
	pongs = 0;
	/** Hold credits back (to test the connector's window), or give them at once. */
	holdCredit = false;
	private held = new Map<number, number>();

	constructor(
		readonly ws_: WebSocket,
		readonly deviceId: string
	) {
		ws_.on('message', (data: Buffer, binary: boolean) =>
			binary ? this.frame(data) : this.control(data)
		);
		ws_.on('close', (code) => (this.closedWith = code));
	}

	/** Request body bytes sent per stream and not credited yet. */
	private sentOut = new Map<number, number>();
	private credits: (() => void)[] = [];

	/** Send a request body as a gateway does: frames only while the window has room (§6.1). */
	private async upload(id: number, body: Buffer) {
		this.sentOut.set(id, 0);
		for (let at = 0; at < body.length; at += LIMITS.maxFrame) {
			while ((this.sentOut.get(id) ?? 0) >= LIMITS.window) {
				await new Promise<void>((r) => this.credits.push(r));
			}
			const piece = body.subarray(at, at + LIMITS.maxFrame);
			this.sentOut.set(id, (this.sentOut.get(id) ?? 0) + piece.length);
			this.sendFrame(1, id, piece);
		}
		this.send({ t: 'req.end', id });
	}

	private control(data: Buffer) {
		const m = JSON.parse(data.toString('utf8')) as Record<string, unknown> & { id: number };
		this.controls.push(m);
		if (m.t === 'pong') this.pongs++;
		if (m.t === 'credit' && this.sentOut.has(m.id)) {
			this.sentOut.set(m.id, this.sentOut.get(m.id)! - (m.bytes as number));
			for (const w of this.credits.splice(0)) w();
		}
		const h = this.http.get(m.id);
		if (h) {
			if (m.t === 'res') {
				h.answer.status = m.status as number;
				h.answer.headers = m.headers as [string, string][];
			} else if (m.t === 'res.end') {
				this.http.delete(m.id);
				h.done();
			} else if (m.t === 'reset') {
				h.answer.reset = m as never;
				this.http.delete(m.id);
				h.done();
			}
		}
		const w = this.ws.get(m.id);
		if (w) {
			if (m.t === 'ws.accept') w.accepted = { protocol: (m.protocol as string | null) ?? null };
			else if (m.t === 'reset') {
				w.reset = m as never;
				this.ws.delete(m.id);
			} else if (m.t === 'ws.close') {
				w.closed = { code: m.code as number, reason: m.reason as string };
				this.ws.delete(m.id);
			}
			w.notify();
		}
	}

	private frame(data: Buffer) {
		const kind = data[0];
		const id = data.readUInt32BE(1);
		const payload = data.subarray(5);
		const h = this.http.get(id);
		if (h && kind === 1) {
			h.answer.body = Buffer.concat([h.answer.body, payload]);
			h.outstanding += payload.length;
			h.answer.maxOutstanding = Math.max(h.answer.maxOutstanding, h.outstanding);
			this.credit(id, payload.length, () => (h.outstanding -= payload.length));
			return;
		}
		const w = this.ws.get(id);
		if (w && (kind === 2 || kind === 3)) {
			w.messages.push({ binary: kind === 3, data: Buffer.from(payload) });
			this.credit(id, payload.length);
			w.notify();
		}
	}

	private credit(id: number, n: number, after?: () => void) {
		if (this.holdCredit) {
			this.held.set(id, (this.held.get(id) ?? 0) + n);
			if (after) this.afters.push(after);
			return;
		}
		after?.();
		this.send({ t: 'credit', id, bytes: n });
	}
	private afters: (() => void)[] = [];

	/** Give back every credit held so far. */
	release() {
		this.holdCredit = false;
		for (const a of this.afters.splice(0)) a();
		for (const [id, n] of this.held) this.send({ t: 'credit', id, bytes: n });
		this.held.clear();
	}

	send(m: Record<string, unknown>) {
		this.ws_.send(JSON.stringify(m));
	}

	sendFrame(kind: number, id: number, payload: Buffer) {
		const head = Buffer.alloc(5);
		head[0] = kind;
		head.writeUInt32BE(id, 1);
		this.ws_.send(Buffer.concat([head, payload]), { binary: true });
	}

	ping() {
		this.send({ t: 'ping', ts: Date.now() });
	}

	/** Relay one HTTP request, as a browser on the relay host would make it. */
	request(o: {
		method?: string;
		path: string;
		target?: { kind: 'app' } | { kind: 'port'; port: number };
		headers?: [string, string][];
		body?: Buffer;
		originChecked?: boolean;
		relay?: unknown;
		id?: number;
	}): Promise<HttpAnswer> & { id: number; answer: HttpAnswer } {
		const id = o.id ?? this.nextId++;
		const answer: HttpAnswer = {
			status: 0,
			headers: [],
			body: Buffer.alloc(0),
			maxOutstanding: 0,
			reset: null
		};
		const done = new Promise<HttpAnswer>((resolve) =>
			this.http.set(id, { answer, outstanding: 0, done: () => resolve(answer) })
		);
		this.send({
			t: 'req',
			id,
			target: o.target ?? { kind: 'app' },
			method: o.method ?? 'GET',
			path: o.path,
			headers: o.headers ?? [],
			body: !!o.body,
			originChecked: o.originChecked ?? false,
			relay: o.relay ?? RELAY
		});
		if (o.body) void this.upload(id, o.body);
		// The answer so far is readable while it streams (server-sent events never end).
		return Object.assign(done, { id, answer });
	}

	/** Relay one WebSocket, as a browser's upgrade on the relay host would. */
	socket(o: {
		path: string;
		protocols?: string[];
		headers?: [string, string][];
		target?: { kind: 'app' } | { kind: 'port'; port: number };
		originChecked?: boolean;
	}): WsStream {
		const id = this.nextId++;
		let wake: () => void = () => {};
		let changed = new Promise<void>((r) => (wake = r));
		const stream: WsStream & { notify: () => void } = {
			accepted: null,
			reset: null,
			messages: [],
			closed: null,
			send: (data) =>
				this.sendFrame(
					typeof data === 'string' ? 2 : 3,
					id,
					typeof data === 'string' ? Buffer.from(data) : data
				),
			close: (code = 1000, reason = '') => this.send({ t: 'ws.close', id, code, reason }),
			ready: Promise.resolve(),
			next: async (n = 1) => {
				while (stream.messages.length < n && !stream.closed && !stream.reset) await changed;
			},
			notify: () => {
				wake();
				changed = new Promise<void>((r) => (wake = r));
			}
		};
		stream.ready = (async () => {
			while (!stream.accepted && !stream.reset) await changed;
		})();
		this.ws.set(id, stream);
		this.send({
			t: 'ws',
			id,
			target: o.target ?? { kind: 'app' },
			path: o.path,
			headers: o.headers ?? [],
			protocols: o.protocols ?? [],
			originChecked: o.originChecked ?? false,
			relay: RELAY
		});
		return stream;
	}

	/** The browser went away: the stream is cancelled. */
	cancel(id: number) {
		this.http.delete(id);
		this.send({ t: 'reset', id, code: 'cancelled' });
	}

	close(code: number) {
		this.ws_.close(code);
	}
}

export class FakeGateway {
	readonly pairings = new Map<string, Pairing>();
	readonly devices = new Map<string, { publicKey: string; name: string; revoked: boolean }>();
	readonly unpaired: string[] = [];
	readonly connects: { deviceId: string; ok: boolean; protocolHeader: string | undefined }[] = [];
	sockets: DeviceSocket[] = [];
	/** What pair/start reports as the fingerprint; by default the real one. */
	lieAboutFingerprint = false;
	/** The page pair/start names for typing the code; a test can make it carry the code. */
	verificationUri = (_code: string) => `${this.origin}/pair`;
	private waiters: ((s: DeviceSocket) => void)[] = [];
	private wss = new WebSocketServer({ noServer: true });

	private constructor(
		private server: Server,
		readonly origin: string
	) {}

	static async start(): Promise<FakeGateway> {
		const server = createServer();
		await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
		const a = server.address();
		const gw = new FakeGateway(
			server,
			`http://127.0.0.1:${typeof a === 'object' && a ? a.port : 0}`
		);
		server.on('request', (req, res) => void gw.http(req, res));
		server.on('upgrade', (req, socket, head) => {
			if (req.url !== '/v1/connect') return socket.destroy();
			gw.wss.handleUpgrade(req, socket, head, (ws) => gw.connect(ws, req));
		});
		return gw;
	}

	async stop() {
		for (const s of this.sockets) s.ws_.terminate();
		this.wss.close();
		await new Promise<void>((r) => this.server.close(() => r()));
		this.server.closeAllConnections();
	}

	/** The pairing the connector started, once it has. */
	async pending(): Promise<Pairing> {
		for (let i = 0; i < 200; i++) {
			const p = [...this.pairings.values()].find((x) => x.status === 'pending');
			if (p) return p;
			await new Promise((r) => setTimeout(r, 10));
		}
		throw new Error('no pairing started');
	}

	/** The captain typed the code and approved. */
	approve(code: string): string {
		const p = [...this.pairings.values()].find(
			(x) => x.code.replace('-', '') === code.replace('-', '').toUpperCase()
		);
		if (!p) throw new Error(`no pairing with code ${code}`);
		p.status = 'approved';
		p.deviceId = randomUUID();
		this.devices.set(p.deviceId, { publicKey: p.publicKey, name: p.name, revoked: false });
		return p.deviceId;
	}

	/** The code ran out before anyone typed it. */
	expire(code: string) {
		for (const p of this.pairings.values()) if (p.code === code) p.status = 'expired';
	}

	/** The next authenticated device socket. */
	nextSocket(): Promise<DeviceSocket> {
		return new Promise((r) => this.waiters.push(r));
	}

	revoke(deviceId: string) {
		const d = this.devices.get(deviceId);
		if (d) d.revoked = true;
		for (const s of this.sockets) if (s.deviceId === deviceId) s.close(4403);
	}

	private async http(req: IncomingMessage, res: import('node:http').ServerResponse) {
		const chunks: Buffer[] = [];
		for await (const c of req) chunks.push(c as Buffer);
		const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as Record<
			string,
			unknown
		>;
		const send = (status: number, v?: unknown) => {
			res.writeHead(status, { 'content-type': 'application/json' });
			res.end(v === undefined ? '' : JSON.stringify(v));
		};
		if (req.method !== 'POST') return send(405);
		if (req.url === '/v1/pair/start') {
			if (body.protocol !== 1 || typeof body.publicKey !== 'string')
				return send(400, { error: 'invalid_request' });
			const id = randomUUID();
			const alphabet = '23456789BCDFGHJKLMNPQRSTVWXZ';
			const raw = [...randomBytes(8)].map((b) => alphabet[b % alphabet.length]).join('');
			const code = `${raw.slice(0, 4)}-${raw.slice(4)}`;
			this.pairings.set(id, {
				id,
				publicKey: body.publicKey,
				name: String(body.name),
				platform: String(body.platform),
				code,
				status: 'pending',
				deviceId: null
			});
			return send(201, {
				pairingId: id,
				userCode: code,
				verificationUri: this.verificationUri(code),
				fingerprint: this.lieAboutFingerprint
					? 'AAAA-AAAA-AAAA-AAAA'
					: fingerprintOf(body.publicKey),
				expiresIn: 600,
				interval: 0.01
			});
		}
		if (req.url === '/v1/pair/poll') {
			const p = this.pairings.get(String(body.pairingId));
			if (!p || !verified(p.publicKey, `whc-pair-poll-v1\n${p.id}`, String(body.sig)))
				return send(401);
			if (p.status === 'expired') return send(410, { status: 'expired' });
			if (p.status === 'approved') {
				return send(200, {
					status: 'approved',
					deviceId: p.deviceId,
					name: p.name,
					user: { name: 'Captain' }
				});
			}
			return send(200, { status: p.status });
		}
		if (req.url === '/v1/device/unpair') {
			const d = this.devices.get(String(body.deviceId));
			const msg = `whc-unpair-v1\n${String(body.deviceId)}\n${String(body.ts)}`;
			if (!d || !verified(d.publicKey, msg, String(body.sig))) return send(401);
			this.unpaired.push(String(body.deviceId));
			this.revoke(String(body.deviceId));
			return send(204);
		}
		send(404);
	}

	private connect(ws: WebSocket, req: IncomingMessage) {
		const nonce = randomBytes(32).toString('base64url');
		ws.send(JSON.stringify({ t: 'hello', protocol: 1, nonce, server: 'fake-gateway/0' }));
		ws.once('message', (data: Buffer) => {
			const m = JSON.parse(data.toString('utf8')) as Record<string, string>;
			const d = this.devices.get(m.deviceId);
			const ok =
				m.t === 'auth' &&
				!!d &&
				verified(d.publicKey, `whc-connect-v1\n${nonce}\n${m.deviceId}`, m.sig);
			this.connects.push({
				deviceId: m.deviceId,
				ok,
				protocolHeader: req.headers['x-whc-protocol'] as string
			});
			if (!ok) return ws.close(4401);
			if (d!.revoked) return ws.close(4403);
			// One socket per device: the newer wins.
			for (const s of this.sockets)
				if (s.deviceId === m.deviceId && s.closedWith === null) s.close(4409);
			const s = new DeviceSocket(ws, m.deviceId);
			this.sockets.push(s);
			ws.send(
				JSON.stringify({
					t: 'ready',
					protocol: 1,
					deviceId: m.deviceId,
					heartbeatMs: 20000,
					limits: LIMITS,
					features: []
				})
			);
			for (const w of this.waiters.splice(0)) w(s);
		});
	}
}
