import { Duplex } from 'node:stream';
import { encodeFrame, FRAME_HTTP, type Limits } from './protocol';

/**
 * The `tls` byte streams one gateway socket carries to a machine with its
 * sealed origin on (§12.3 of the protocol, reusing §6.8's `tcp` machinery):
 * each is a browser's TLS connection to one of this machine's names, its
 * records carried unchanged both ways as `0x01` frames under the stream's
 * credit window (`limits.tlsWindow`), and handed to the machine's own TLS
 * server as a duplex. It is done once both sides have sent `tcp.end`, or at
 * once on a `reset`.
 */

export interface OriginStreamsOptions {
	send: (msg: Record<string, unknown>) => void;
	sendFrame: (frame: Buffer) => void;
	limits: Limits;
	/** Why this machine won't take a `tls` stream for `host` (the SNI), or null when it will. */
	refusal: (host: string) => string | null;
	/** Terminate TLS on an accepted stream; `ip` is only for the machine's own limits. */
	serve: (stream: Duplex, info: { host: string; ip: string | null }) => void;
	log?: (line: string) => void;
}

interface OriginStream {
	onControl(msg: Record<string, unknown>): void;
	onData(kind: number, payload: Buffer): void;
	abort(): void;
}

/** Credit is given back in batches of this much, or at once when everything was read. */
const CREDIT_BATCH = 64 * 1024;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

export class OriginStreams {
	private streams = new Map<number, OriginStream>();
	private closed = false;

	constructor(private opts: OriginStreamsOptions) {}

	/** Whether a control message or frame is for one of these streams. */
	has(id: number): boolean {
		return this.streams.has(id);
	}

	/** A control message: a new `tcp`, or `tcp.end`, `credit` or `reset` for a stream. */
	control(msg: Obj): void {
		if (this.closed) return;
		const id = msg.id;
		if (typeof id !== 'number' || !Number.isInteger(id) || id < 0) return;
		if (msg.t === 'tcp') return this.accept(id, msg);
		const s = this.streams.get(id);
		if (!s) return;
		if (msg.t === 'reset') {
			this.streams.delete(id);
			return s.abort();
		}
		s.onControl(msg);
	}

	frame(kind: number, id: number, payload: Buffer): void {
		this.streams.get(id)?.onData(kind, payload);
	}

	/** The device socket is gone: every stream on it ends. */
	closeAll(): void {
		this.closed = true;
		const all = [...this.streams.values()];
		this.streams.clear();
		for (const s of all) s.abort();
	}

	private reset(id: number, code: string, message?: string): void {
		this.streams.delete(id);
		this.opts.send({ t: 'reset', id, code, ...(message ? { message } : {}) });
	}

	private accept(id: number, msg: Obj): void {
		if (this.streams.has(id)) return this.reset(id, 'protocol');
		if (this.streams.size >= this.opts.limits.maxStreams) return this.reset(id, 'limit');
		const target = isObj(msg.target) ? msg.target : {};
		const host = typeof target.host === 'string' ? target.host.toLowerCase() : '';
		const refused =
			target.kind !== 'tls' ? 'this machine carries only its own origin' : this.opts.refusal(host);
		if (refused) {
			this.opts.log?.(`refused a TLS connection: ${refused}`);
			return this.reset(id, 'refused', refused);
		}
		const client = isObj(msg.client) ? msg.client : {};
		const ip = typeof client.ip === 'string' ? client.ip.slice(0, 64) : null;
		this.start(id, host, ip);
	}

	private start(id: number, host: string, ip: string | null): void {
		const { send, sendFrame, limits } = this.opts;
		const window = limits.tlsWindow;
		let sentUncredited = 0;
		let recvUncredited = 0;
		let pendingCredit = 0;
		/** Bytes pushed while the reader was full, credited once it reads again. */
		let heldCredit = 0;
		let finished = false;
		let localEnded = false;
		let peerEnded = false;
		/** What is left of a write, sent as the gateway's credit allows. */
		let waiting: { chunk: Buffer; callback: () => void } | null = null;
		const pump = () => {
			while (waiting && sentUncredited < window && !finished) {
				const part = waiting.chunk.subarray(0, limits.maxFrame);
				waiting.chunk = waiting.chunk.subarray(part.length);
				sendFrame(encodeFrame(FRAME_HTTP, id, part));
				sentUncredited += part.length;
				if (!waiting.chunk.length) {
					const { callback } = waiting;
					waiting = null;
					callback();
				}
			}
		};
		const credit = (n: number) => {
			recvUncredited -= n;
			pendingCredit += n;
			if (finished || (pendingCredit < CREDIT_BATCH && recvUncredited > 0)) return;
			send({ t: 'credit', id, bytes: pendingCredit });
			pendingCredit = 0;
		};
		const fail = (code: string) => {
			if (finished) return;
			finished = true;
			if (this.streams.get(id) === entry) this.reset(id, code);
			stream.destroy();
		};
		const maybeDone = () => {
			if (!localEnded || !peerEnded || finished) return;
			finished = true;
			if (this.streams.get(id) === entry) this.streams.delete(id);
		};
		const stream = new Duplex({
			allowHalfOpen: true,
			read: () => {
				const n = heldCredit;
				heldCredit = 0;
				if (n) credit(n);
			},
			write: (chunk: Buffer, _encoding, callback) => {
				if (finished) return callback(new Error('stream closed'));
				waiting = { chunk, callback };
				pump();
			},
			final: (callback) => {
				if (!finished && !localEnded) {
					localEnded = true;
					send({ t: 'tcp.end', id });
					maybeDone();
				}
				callback();
			},
			destroy: (err, callback) => {
				if (!finished && !(localEnded && peerEnded)) fail(err ? 'internal' : 'cancelled');
				waiting = null;
				callback(err);
			}
		});
		const entry: OriginStream = {
			onControl: (m) => {
				if (m.t === 'tcp.end') {
					if (peerEnded) return fail('protocol');
					peerEnded = true;
					stream.push(null);
					maybeDone();
				} else if (m.t === 'credit') {
					sentUncredited = Math.max(0, sentUncredited - (Number(m.bytes) || 0));
					pump();
				}
			},
			onData: (kind, payload) => {
				if (peerEnded || kind !== FRAME_HTTP) return fail('protocol');
				recvUncredited += payload.length;
				// Data past the window is a protocol error for the stream (§12.10).
				if (recvUncredited > window + limits.maxFrame) return fail('protocol');
				if (stream.push(payload)) credit(payload.length);
				else heldCredit += payload.length;
			},
			abort: () => {
				finished = true;
				stream.destroy();
			}
		};
		this.streams.set(id, entry);
		send({ t: 'tcp.accept', id });
		try {
			this.opts.serve(stream, { host, ip });
		} catch (e) {
			this.opts.log?.(`could not serve a TLS connection: ${(e as Error).message}`);
			fail('internal');
		}
	}
}
