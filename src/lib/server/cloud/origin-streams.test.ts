import type { Duplex } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { OriginStreams } from './origin-streams';
import { DEFAULT_LIMITS, decodeFrame, FRAME_HTTP } from './protocol';

/** `tls` streams (§12.3) on their own: admission, flow control both ways, and the end of a stream. */

const limits = { ...DEFAULT_LIMITS, maxStreams: 2, maxFrame: 4, tlsWindow: 16 };

function streams(refusal: (host: string) => string | null = () => null) {
	const sent: Record<string, unknown>[] = [];
	const frames: { id: number; payload: Buffer }[] = [];
	const served: { stream: Duplex; host: string; ip: string | null }[] = [];
	const o = new OriginStreams({
		limits,
		send: (m) => sent.push(m),
		sendFrame: (f) => {
			const d = decodeFrame(f)!;
			frames.push({ id: d.id, payload: d.payload });
		},
		refusal,
		serve: (stream, info) => served.push({ stream, ...info })
	});
	const open = (id: number, host = 'app.example') =>
		o.control({ t: 'tcp', id, target: { kind: 'tls', host }, client: { ip: '203.0.113.7' } });
	return { o, sent, frames, served, open };
}

describe('tls streams', () => {
	it('accepts one for a name the machine serves and hands it to the TLS server', () => {
		const { sent, served, open } = streams();
		open(1, 'App.Example');
		expect(sent).toEqual([{ t: 'tcp.accept', id: 1 }]);
		expect(served[0]).toMatchObject({ host: 'app.example', ip: '203.0.113.7' });
	});

	it('refuses another target, a name it does not serve, a repeated id and one past the stream limit', () => {
		const { o, sent, open } = streams((host) => (host === 'foreign' ? 'not its name' : null));
		o.control({ t: 'tcp', id: 1, target: { kind: 'ssh' } });
		open(2, 'foreign');
		open(3);
		open(3);
		open(4);
		open(5);
		expect(sent).toEqual([
			{ t: 'reset', id: 1, code: 'refused', message: 'this machine carries only its own origin' },
			{ t: 'reset', id: 2, code: 'refused', message: 'not its name' },
			{ t: 'tcp.accept', id: 3 },
			{ t: 'reset', id: 3, code: 'protocol' },
			{ t: 'tcp.accept', id: 4 },
			{ t: 'tcp.accept', id: 5 }
		]);
	});

	it('sends what the TLS server writes in frames, never past the window until credited', async () => {
		const { o, frames, served, open } = streams();
		open(1);
		const done = new Promise<void>((r) => served[0].stream.write(Buffer.alloc(40, 1), () => r()));
		expect(frames.map((f) => f.payload.length)).toEqual([4, 4, 4, 4]);
		o.control({ t: 'credit', id: 1, bytes: 8 });
		expect(frames).toHaveLength(6);
		o.control({ t: 'credit', id: 1, bytes: 32 });
		await done;
		expect(Buffer.concat(frames.map((f) => f.payload))).toEqual(Buffer.alloc(40, 1));
	});

	it('passes the browser’s bytes on and credits them as they are read', () => {
		const { o, sent, served, open } = streams();
		open(1);
		o.frame(FRAME_HTTP, 1, Buffer.from('hell'));
		o.frame(FRAME_HTTP, 1, Buffer.from('o'));
		expect(served[0].stream.read()?.toString()).toBe('hello');
		expect(sent.filter((m) => m.t === 'credit')).toEqual([
			{ t: 'credit', id: 1, bytes: 4 },
			{ t: 'credit', id: 1, bytes: 1 }
		]);
	});

	it('resets a stream the gateway sends past its window', () => {
		const { o, sent, served, open } = streams();
		open(1);
		// Nothing reads: once the TLS server's buffer is full the window fills, and a frame past it is a protocol error.
		served[0].stream.pause();
		const buffered = served[0].stream.readableHighWaterMark;
		for (let i = 0; i < buffered / 4 + 8; i++) o.frame(FRAME_HTTP, 1, Buffer.alloc(4));
		expect(sent.at(-1)).toEqual({ t: 'reset', id: 1, code: 'protocol' });
		expect(served[0].stream.destroyed).toBe(true);
	});

	it('ends once both sides have sent tcp.end, and on a reset at once', async () => {
		const { o, sent, served, open } = streams();
		open(1);
		const s = served[0].stream;
		const ended = new Promise<void>((r) => s.once('end', () => r()));
		s.resume();
		o.control({ t: 'tcp.end', id: 1 });
		await ended;
		s.end();
		await new Promise((r) => setImmediate(r));
		expect(sent.at(-1)).toEqual({ t: 'tcp.end', id: 1 });
		expect(o.has(1)).toBe(false);
		open(2);
		o.control({ t: 'reset', id: 2, code: 'cancelled' });
		expect(served[1].stream.destroyed).toBe(true);
		expect(o.has(2)).toBe(false);
	});

	it('ends every stream when the socket goes, and takes no new one', () => {
		const { o, sent, served, open } = streams();
		open(1);
		o.closeAll();
		expect(served[0].stream.destroyed).toBe(true);
		open(2);
		expect(sent).toEqual([{ t: 'tcp.accept', id: 1 }]);
	});
});
