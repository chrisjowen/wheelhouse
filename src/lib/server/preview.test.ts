import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { CLOSED, PreviewProber, proxiedFrameRefusal, STOPPED } from './preview';

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

	it('lets a preview that refuses only by X-Frame-Options be framed through the preview proxy', async () => {
		const ide = 'https://4310--x.example.dev';
		const proxied = await new PreviewProber().check({ url: `${base}/deny`, reportedAt: at }, ide, {
			proxied: true
		});
		expect(proxied).toMatchObject({ state: 'live', reason: null });
		// Its own frame-ancestors still apply, judged at the proxy's address on the page's origin.
		const csp = await new PreviewProber().check({ url: `${base}/csp`, reportedAt: at }, ide, {
			proxied: true
		});
		expect(csp.state).toBe('blocked');
		// Not proxied (the default): refused, exactly as before.
		const direct = await new PreviewProber().check({ url: `${base}/deny`, reportedAt: at }, ide);
		expect(direct.state).toBe('blocked');
	});

	it('judges a proxied preview’s frame-ancestors at its address on the page’s origin', () => {
		const ide = 'https://4310--x.example.dev';
		const self = new Headers({ 'content-security-policy': "frame-ancestors 'self'" });
		expect(proxiedFrameRefusal(self, 'http://127.0.0.1:8790/app', ide)).toBeNull();
		const local = new Headers({ 'content-security-policy': 'frame-ancestors http://127.0.0.1:*' });
		expect(proxiedFrameRefusal(local, 'http://127.0.0.1:8790/', ide)).toMatch(/frame-ancestors/);
	});

	it('judges frame-ancestors against the page origin asking', async () => {
		const p = new PreviewProber();
		const preview = { url: `${base}/csp`, reportedAt: at };
		expect((await p.check(preview, page)).state).toBe('live');
		const r = await p.check(preview, 'http://localhost:4396');
		expect(r.state).toBe('blocked');
		expect(r.reason).toMatch(/frame-ancestors/);
	});

	it('says plainly when nothing answers: stopped, or closed once the work has landed', async () => {
		const closed = createServer();
		await new Promise<void>((r) => closed.listen(0, '127.0.0.1', r));
		const port = (closed.address() as AddressInfo).port;
		await new Promise<void>((r) => closed.close(() => r()));
		const preview = { url: `http://127.0.0.1:${port}/`, reportedAt: at };
		const r = await new PreviewProber().check(preview, page);
		expect(r).toMatchObject({ state: 'down', reason: STOPPED });
		expect(r.reason).not.toMatch(/127\.0\.0\.1|port|http/i);
		expect((await new PreviewProber().check(preview, page, { landed: true })).reason).toBe(CLOSED);
	});

	it('counts a preview that does not answer in time as stopped', async () => {
		const f = vi.fn(
			(_url: string, init: RequestInit) =>
				new Promise<Response>((_res, rej) =>
					init.signal!.addEventListener('abort', () => rej(init.signal!.reason))
				)
		);
		const r = await new PreviewProber({ fetch: f as unknown as typeof fetch, timeoutMs: 20 }).check(
			{ url: 'http://127.0.0.1:9/', reportedAt: at },
			page
		);
		expect(r.state).toBe('down');
	});

	it('does not follow a redirect, even to another machine', async () => {
		const f = vi.fn(
			async () => new Response(null, { status: 302, headers: { location: 'http://example.com/' } })
		);
		const r = await new PreviewProber({ fetch: f as unknown as typeof fetch }).check(
			{ url: 'http://127.0.0.1:9/', reportedAt: at },
			page
		);
		expect(f).toHaveBeenCalledTimes(1);
		expect(f.mock.calls[0]).toEqual([
			'http://127.0.0.1:9/',
			expect.objectContaining({ redirect: 'manual' })
		]);
		expect(r.state).toBe('live');
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
