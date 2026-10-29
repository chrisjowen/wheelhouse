import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { request } from 'node:http';
import { SandboxServer, SANDBOX_PATH, sandboxPage } from './sandbox';

/** GET a path from the sandbox with a given Host header. */
function get(base: string, p: string, host?: string) {
	const u = new URL(p, base);
	return new Promise<{ status: number; headers: Record<string, unknown>; body: string }>(
		(resolve, reject) => {
			const req = request(
				{
					host: u.hostname,
					port: u.port,
					path: u.pathname + u.search,
					headers: { host: host ?? u.host }
				},
				(res) => {
					let body = '';
					res.on('data', (c) => (body += c));
					res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
				}
			);
			req.on('error', reject);
			req.end();
		}
	);
}

describe('the MCP app sandbox', () => {
	const sandbox = new SandboxServer();
	let base = '';
	beforeAll(async () => {
		await sandbox.start(0);
		const at = sandbox.url();
		if (!('url' in at)) throw new Error(at.reason);
		base = at.url.replace(SANDBOX_PATH, '');
	});
	afterAll(() => sandbox.close());

	it('listens on loopback, on a port of its own', () => {
		expect(base).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
	});

	it('serves the proxy with the app’s policy, framed only by the Wheelhouse page named', async () => {
		const csp = encodeURIComponent(JSON.stringify({ connectDomains: ['https://api.example.com'] }));
		const host = encodeURIComponent('http://127.0.0.1:4310');
		const r = await get(base, `${SANDBOX_PATH}?host=${host}&csp=${csp}`);
		expect(r.status).toBe(200);
		expect(r.headers['content-type']).toBe('text/html; charset=utf-8');
		const policy = String(r.headers['content-security-policy']);
		expect(policy).toContain("default-src 'none'");
		expect(policy).toContain("connect-src 'self' https://api.example.com");
		expect(policy).toContain('frame-ancestors http://127.0.0.1:4310');
		expect(r.headers['cache-control']).toBe('no-store');
		expect(r.body).toContain('"http://127.0.0.1:4310"');
		expect(r.body).toContain('ui/notifications/sandbox-');
	});

	it('refuses a framing page that is not Wheelhouse on loopback, and a policy that is not JSON', async () => {
		for (const host of ['https://evil.example.com', 'http://127.0.0.1.evil.com', 'null', '']) {
			const r = await get(base, `${SANDBOX_PATH}?host=${encodeURIComponent(host)}`);
			expect(r.status).toBe(400);
		}
		const r = await get(
			base,
			`${SANDBOX_PATH}?host=${encodeURIComponent('http://localhost:1')}&csp=nope`
		);
		expect(r.status).toBe(400);
	});

	it('serves nothing else, and answers loopback Host headers only', async () => {
		expect((await get(base, '/')).status).toBe(404);
		expect((await get(base, '/api/fleet')).status).toBe(404);
		const host = encodeURIComponent('http://127.0.0.1:4310');
		expect((await get(base, `${SANDBOX_PATH}?host=${host}`, 'evil.example.com')).status).toBe(421);
	});

	it('keeps the host origin from breaking out of its script', () => {
		expect(sandboxPage('http://127.0.0.1:1</script>')).not.toContain('</script>"');
	});
});
