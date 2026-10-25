import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PreviewProber } from './preview';

let server: Server;
let base = '';

beforeAll(async () => {
	server = createServer((req, res) => {
		if (req.url === '/deny') res.setHeader('x-frame-options', 'DENY');
		if (req.url === '/csp')
			res.setHeader('content-security-policy', 'frame-ancestors http://127.0.0.1:*');
		res.end('ok');
	});
	await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
	base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

const at = '2026-10-25T10:00:00.000Z';
const page = 'http://127.0.0.1:4396';

describe('PreviewProber', () => {
	it('says when no preview was reported', async () => {
		const r = await new PreviewProber().check(null, page);
		expect(r.state).toBe('none');
		expect(r.url).toBeNull();
	});

	it('shows a loopback preview that answers', async () => {
		const r = await new PreviewProber().check({ url: `${base}/`, reportedAt: at }, page);
		expect(r).toMatchObject({ url: `${base}/`, reportedAt: at, state: 'live', reason: null });
	});

	it('says a preview refuses framing', async () => {
		const r = await new PreviewProber().check({ url: `${base}/deny`, reportedAt: at }, page);
		expect(r.state).toBe('blocked');
		expect(r.reason).toMatch(/X-Frame-Options/);
	});

	it('judges frame-ancestors against the page origin asking', async () => {
		const p = new PreviewProber();
		const preview = { url: `${base}/csp`, reportedAt: at };
		expect((await p.check(preview, page)).state).toBe('live');
		const r = await p.check(preview, 'http://localhost:4396');
		expect(r.state).toBe('blocked');
		expect(r.reason).toMatch(/frame-ancestors/);
	});

	it('says plainly when nothing answers', async () => {
		const closed = createServer();
		await new Promise<void>((r) => closed.listen(0, '127.0.0.1', r));
		const port = (closed.address() as AddressInfo).port;
		await new Promise<void>((r) => closed.close(() => r()));
		const r = await new PreviewProber().check(
			{ url: `http://127.0.0.1:${port}/`, reportedAt: at },
			page
		);
		expect(r.state).toBe('down');
		expect(r.reason).toMatch(/Preview not running/);
	});

	it('never fetches a preview that is not on this machine', async () => {
		const f = vi.fn();
		const r = await new PreviewProber({ fetch: f }).check(
			{
				url: 'http://example.com/',
				reportedAt: at
			},
			page
		);
		expect(r.state).toBe('refused');
		expect(f).not.toHaveBeenCalled();
	});

	it('checks each URL at most every few seconds', async () => {
		let now = 0;
		const f = vi.fn(async () => new Response('ok'));
		const p = new PreviewProber({ fetch: f as unknown as typeof fetch, now: () => now });
		const preview = { url: 'http://127.0.0.1:9/', reportedAt: at };
		await p.check(preview, page);
		await p.check(preview, page);
		expect(f).toHaveBeenCalledTimes(1);
		now = 6_000;
		await p.check(preview, page);
		expect(f).toHaveBeenCalledTimes(2);
	});
});
