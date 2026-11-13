import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { request } from 'node:http';
import { cspHeader } from '../../apps/csp';
import { Sandboxes, SandboxServer, SANDBOX_PATH, sandboxPage, signCsp } from './sandbox';

/** GET a path from the sandbox with a given Host header (and any others). */
function get(base: string, p: string, host?: string, more: Record<string, string> = {}) {
	const u = new URL(p, base);
	return new Promise<{ status: number; headers: Record<string, unknown>; body: string }>(
		(resolve, reject) => {
			const req = request(
				{
					host: u.hostname,
					port: u.port,
					path: u.pathname + u.search,
					headers: { ...more, host: host ?? u.host }
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
	/** The signed sandbox page for `csp`, framed by `host`. */
	const page = (csp: object, host = 'http://127.0.0.1:4310') => {
		const at = sandbox.url(csp);
		if (!('url' in at)) throw new Error(at.reason);
		const u = new URL(at.url);
		u.searchParams.set('host', host);
		return u;
	};
	beforeAll(async () => {
		await sandbox.start();
		base = page({}).origin;
	});
	afterAll(() => sandbox.close());

	it('listens on loopback, on a port of its own', () => {
		expect(base).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
	});

	it('serves the proxy with the app’s policy, framed only by the Wheelhouse page named', async () => {
		const u = page({ connectDomains: ['https://api.example.com'] });
		expect(u.pathname).toBe(SANDBOX_PATH);
		const r = await get(base, u.pathname + u.search);
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

	it('refuses a framing page that is not Wheelhouse on loopback', async () => {
		for (const host of ['https://evil.example.com', 'http://127.0.0.1.evil.com', 'null', '']) {
			const u = page({}, host);
			expect((await get(base, u.pathname + u.search)).status).toBe(400);
		}
	});

	it('serves only a policy it signed: not an unsigned, changed or otherwise-signed one', async () => {
		const wide = JSON.stringify({ connectDomains: ['https://evil.example'] });
		const tries = (u: URL) => get(base, u.pathname + u.search).then((r) => r.status);

		const unsigned = page({});
		unsigned.searchParams.delete('sig');
		expect(await tries(unsigned)).toBe(400);
		const noPolicy = page({});
		noPolicy.searchParams.delete('csp');
		expect(await tries(noPolicy)).toBe(400);

		const changed = page({ connectDomains: ['https://api.example.com'] });
		changed.searchParams.set('csp', wide);
		expect(await tries(changed)).toBe(400);

		const otherKey = page({});
		otherKey.searchParams.set('csp', wide);
		otherKey.searchParams.set('sig', signCsp(Buffer.alloc(32, 7), wide));
		expect(await tries(otherKey)).toBe(400);

		// Another sandbox's signature, for the very same policy, is no good here either.
		const other = new SandboxServer();
		await other.start();
		const theirs = other.url({});
		other.close();
		if (!('url' in theirs)) throw new Error(theirs.reason);
		const borrowed = page({});
		borrowed.searchParams.set('sig', new URL(theirs.url).searchParams.get('sig')!);
		expect(await tries(borrowed)).toBe(400);

		expect(await tries(page({}))).toBe(200);
	});

	it('serves nothing else, and answers loopback Host headers only', async () => {
		expect((await get(base, '/')).status).toBe(404);
		expect((await get(base, '/api/fleet')).status).toBe(404);
		const u = page({});
		expect((await get(base, u.pathname + u.search, 'evil.example.com')).status).toBe(421);
	});

	it('is framed by a page that came through Wheelhouse Cloud, as the connector names it', async () => {
		const relayed = 'https://abcdefghijklmnopqrst.cloud.test';
		const u = page({ connectDomains: ['https://api.example.com'] }, relayed);
		const port = new URL(base).port;
		// As the connector sends it: a loopback Host, and who the request came through.
		const viaRelay = { 'x-wheelhouse-remote': '1', 'x-wheelhouse-remote-origin': relayed };
		const r = await get(base, u.pathname + u.search, `localhost:${port}`, viaRelay);
		expect(r.status).toBe(200);
		const policy = String(r.headers['content-security-policy']);
		expect(policy).toBe(
			`${cspHeader({ connectDomains: ['https://api.example.com'] })}; frame-ancestors ${relayed}`
		);
		expect(r.body).toContain(`"${relayed}"`);

		// Not without the connector's word, nor for another page, nor with a policy it did not sign.
		const status = (url: URL, headers: Record<string, string>) =>
			get(base, url.pathname + url.search, `localhost:${port}`, headers).then((x) => x.status);
		expect(await status(u, {})).toBe(400);
		expect(await status(u, { 'x-wheelhouse-remote-origin': relayed })).toBe(400);
		expect(
			await status(u, { ...viaRelay, 'x-wheelhouse-remote-origin': 'https://other.cloud.test' })
		).toBe(400);
		const evil = page({}, 'https://evil.example.com');
		expect(await status(evil, viaRelay)).toBe(400);
		const odd = page({}, `${relayed}/path`);
		expect(
			await status(odd, { ...viaRelay, 'x-wheelhouse-remote-origin': `${relayed}/path` })
		).toBe(400);
		const unsigned = page({}, relayed);
		unsigned.searchParams.set('csp', JSON.stringify({ connectDomains: ['https://evil.example'] }));
		expect(await status(unsigned, viaRelay)).toBe(400);
	});

	it('keeps the host origin from breaking out of its script', () => {
		expect(sandboxPage('http://127.0.0.1:1</script>')).not.toContain('</script>"');
	});
});

describe('the sandboxes, one for each MCP server', () => {
	const sandboxes = new Sandboxes();
	afterAll(() => sandboxes.close());

	const origin = async (key: string) => {
		const at = await sandboxes.url(key, {});
		if (!('url' in at)) throw new Error(at.reason);
		return new URL(at.url).origin;
	};

	it('gives two servers different origins, and one server the same one each time', async () => {
		const [a, b] = await Promise.all([origin('demo/one@'), origin('demo/two@')]);
		expect(a).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
		expect(b).not.toBe(a);
		expect(await origin('demo/one@')).toBe(a);
		expect(await origin('demo/one@project')).not.toBe(a);
	});

	it('serves each server’s signed policy from its own sandbox only', async () => {
		const at = await sandboxes.url('demo/one@', {});
		if (!('url' in at)) throw new Error(at.reason);
		const u = new URL(at.url);
		u.searchParams.set('host', 'http://127.0.0.1:4310');
		expect((await get(u.origin, u.pathname + u.search)).status).toBe(200);
		expect((await get(await origin('demo/two@'), u.pathname + u.search)).status).toBe(400);
	});
});

describe('a sandbox in a hosted dev environment', () => {
	let pattern = 'https://{port}-abc.ws-eu45.gitpod.io';
	const sandbox = new SandboxServer({ hosted: () => pattern, pagePort: () => 4310 });
	let base = '';
	let port = '';
	const page = () => {
		const at = sandbox.url({});
		if (!('url' in at)) throw new Error(at.reason);
		const u = new URL(at.url);
		u.searchParams.set('host', 'http://localhost:4310');
		return u;
	};
	beforeAll(async () => {
		await sandbox.start();
		base = page().origin;
		port = new URL(base).port;
	});
	afterAll(() => sandbox.close());

	it('answers the environment’s host for its port, as well as loopback, and no other', async () => {
		pattern = 'https://{port}-abc.ws-eu45.gitpod.io';
		const u = page();
		const at = (host: string, path = u.pathname) =>
			get(base, path + u.search, host).then((r) => r.status);
		expect(await at(`${port}-abc.ws-eu45.gitpod.io`)).toBe(200);
		expect(await at(`127.0.0.1:${port}`)).toBe(200);
		expect(await at(`1${port}-abc.ws-eu45.gitpod.io`)).toBe(421);
		expect(await at('evil.example.com')).toBe(421);
		const r = await get(base, u.pathname + u.search, `${port}-abc.ws-eu45.gitpod.io`);
		expect(String(r.headers['content-security-policy'])).toBe(
			`${cspHeader({})}; frame-ancestors http://localhost:4310`
		);
	});

	it('is framed by Wheelhouse’s own page at the environment’s URL, and no other port’s', async () => {
		pattern = 'https://{port}-abc.ws-eu45.gitpod.io';
		const u = page();
		const framed = (host: string) => {
			u.searchParams.set('host', host);
			return get(base, u.pathname + u.search, `${port}-abc.ws-eu45.gitpod.io`);
		};
		const ok = await framed('https://4310-abc.ws-eu45.gitpod.io');
		expect(ok.status).toBe(200);
		expect(String(ok.headers['content-security-policy'])).toBe(
			`${cspHeader({})}; frame-ancestors https://4310-abc.ws-eu45.gitpod.io`
		);
		expect((await framed('https://5173-abc.ws-eu45.gitpod.io')).status).toBe(400);
		expect((await framed(`https://${port}-abc.ws-eu45.gitpod.io`)).status).toBe(400);
		expect((await framed('https://4310-xyz.ws-eu45.gitpod.io')).status).toBe(400);
	});

	it('answers its page under the path a host of its own serves its port at', async () => {
		pattern = 'https://{port}.example.dev/base';
		const u = page();
		const at = (host: string, path: string) =>
			get(base, path + u.search, host).then((r) => r.status);
		expect(await at(`${port}.example.dev`, '/base/sandbox.html')).toBe(200);
		expect(await at(`${port}.example.dev`, '/sandbox.html')).toBe(200);
		expect(await at(`127.0.0.1:${port}`, '/base/sandbox.html')).toBe(404);
		expect(await at(`${port}.example.dev`, '/other/sandbox.html')).toBe(404);
	});

	it('is not carried by an environment that serves ports under a path, on the page’s origin', async () => {
		pattern = 'https://code.example.dev/proxy/{port}';
		const u = page();
		const at = (host: string, path: string, framer: string) => {
			u.searchParams.set('host', framer);
			return get(base, path + u.search, host).then((r) => r.status);
		};
		expect(
			await at('code.example.dev', `/proxy/${port}/sandbox.html`, 'https://code.example.dev')
		).toBe(421);
		expect(await at('code.example.dev', '/sandbox.html', 'http://localhost:4310')).toBe(421);
		expect(
			await at(`127.0.0.1:${port}`, `/proxy/${port}/sandbox.html`, 'http://localhost:4310')
		).toBe(404);
		expect(await at(`127.0.0.1:${port}`, '/sandbox.html', 'https://code.example.dev')).toBe(400);
		expect(await at(`127.0.0.1:${port}`, '/sandbox.html', 'http://localhost:4310')).toBe(200);
	});
});
