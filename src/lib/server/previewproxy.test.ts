import http, { type IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket, WebSocketServer } from 'ws';
import {
	parsePreviewPorts,
	portAllowed,
	PreviewProxy,
	PROXY_CSP,
	PROXY_ORIGIN_HEADER,
	proxiedFraming,
	proxiedLocation,
	proxiedResponseHeaders,
	proxyTarget,
	upstreamHeaders
} from './previewproxy';
import { SESSION_HEADER } from './session';

describe('the preview proxy’s rules', () => {
	it('reads /_p/<port>/<path> and nothing else', () => {
		expect(proxyTarget('/_p/8790/')).toEqual({ port: 8790, path: '/' });
		expect(proxyTarget('/_p/8790/a/b.js?x=1')).toEqual({ port: 8790, path: '/a/b.js?x=1' });
		expect(proxyTarget('/_p/8790')).toEqual({ redirect: '/_p/8790/' });
		expect(proxyTarget('/_p/8790?x=1')).toEqual({ redirect: '/_p/8790/?x=1' });
		for (const url of ['/_p/', '/_p/0/', '/_p/08790/', '/_p/65536/', '/_p/x/', '/_p/-1/', '/_p']) {
			expect(proxyTarget(url), url).toBeNull();
		}
	});

	it('opens a port Wheelhouse shows or was told to, never one of its own', () => {
		const o = { shown: [8790, 4310], extra: [9000], own: [4310] };
		expect(portAllowed(8790, o)).toBe(true);
		expect(portAllowed(9000, o)).toBe(true);
		expect(portAllowed(4310, o)).toBe(false);
		expect(portAllowed(22, o)).toBe(false);
		expect(portAllowed(9000, { ...o, own: [9000] })).toBe(false);
	});

	it('reads WHEELHOUSE_PREVIEW_PORTS, saying which entries are not ports', () => {
		expect(parsePreviewPorts(undefined)).toEqual({ ports: [], invalid: [] });
		expect(parsePreviewPorts(' 5173, 8080,,5173 ,x,0,70000,1e3')).toEqual({
			ports: [5173, 8080],
			invalid: ['x', '0', '70000', '1e3']
		});
	});

	it('rewrites a redirect to the preview itself, and leaves any other', () => {
		expect(proxiedLocation('/login?next=/', 8790)).toBe('/_p/8790/login?next=/');
		expect(proxiedLocation('http://127.0.0.1:8790/a#b', 8790)).toBe('/_p/8790/a#b');
		expect(proxiedLocation('http://localhost:8790/', 8790)).toBe('/_p/8790/');
		for (const keep of [
			'next',
			'./next',
			'//evil.com/x',
			'/\\evil.com',
			'http://127.0.0.1:9999/',
			'https://example.com/',
			'http://user:pw@127.0.0.1:8790/'
		]) {
			expect(proxiedLocation(keep, 8790), keep).toBe(keep);
		}
	});

	it('gives the preview its own Host and Origin, and none of Wheelhouse’s headers', () => {
		const served = 'https://4310--x.example.dev';
		const h: IncomingHttpHeaders = {
			host: '4310--x.example.dev',
			origin: served,
			referer: `${served}/tasks/t-1`,
			[SESSION_HEADER]: 'secret',
			'x-wheelhouse-remote': '1',
			[PROXY_ORIGIN_HEADER]: 'https://evil.com',
			connection: 'keep-alive',
			'transfer-encoding': 'chunked',
			accept: 'text/html'
		};
		expect(upstreamHeaders(h, 8790, served)).toEqual({
			host: '127.0.0.1:8790',
			origin: 'http://127.0.0.1:8790',
			accept: 'text/html',
			[PROXY_ORIGIN_HEADER]: served
		});
		// Any other Origin (a proxied page's `null`, another site's) is passed on as it is.
		expect(upstreamHeaders({ ...h, origin: 'null' }, 8790, served).origin).toBe('null');
		expect(upstreamHeaders({ ...h, origin: 'https://evil.com' }, 8790, served).origin).toBe(
			'https://evil.com'
		);
		const ws = upstreamHeaders(
			{ ...h, upgrade: 'websocket', connection: 'Upgrade' },
			8790,
			served,
			{
				websocket: true
			}
		);
		expect(ws).toMatchObject({ upgrade: 'websocket', connection: 'Upgrade' });
	});

	it('drops X-Frame-Options and adds the sandbox to the preview’s own policy', () => {
		const out = proxiedResponseHeaders(
			{
				'x-frame-options': 'DENY',
				'content-security-policy': "default-src 'self'",
				location: '/next',
				'content-type': 'text/html',
				connection: 'keep-alive'
			},
			8790
		);
		expect(out).toEqual({
			'content-security-policy': `default-src 'self', ${PROXY_CSP}`,
			location: '/_p/8790/next',
			'content-type': 'text/html'
		});
		expect(proxiedResponseHeaders({}, 8790)['content-security-policy']).toBe(PROXY_CSP);
	});

	it('keeps an upstream sandbox directive as its own policy, not merged with ours', () => {
		const out = proxiedResponseHeaders(
			{ 'content-security-policy': 'sandbox allow-scripts allow-same-origin' },
			8790
		);
		expect(out['content-security-policy']).toBe(
			`sandbox allow-scripts allow-same-origin, ${PROXY_CSP}`
		);
	});

	it('frames previews through it only while it is on, at a path pattern, for a page served here', () => {
		const on = { WHEELHOUSE_PREVIEW_PROXY: 'on' };
		const proxy = { pattern: '/_p/{port}', source: 'proxy' as const };
		const here = new Request('http://127.0.0.1:4310/api/previews/check');
		const relayed = new Request('http://127.0.0.1:4310/api/previews/check', {
			headers: { 'x-wheelhouse-remote': '1' }
		});
		expect(proxiedFraming(here, proxy, on)).toBe(true);
		expect(proxiedFraming(here, proxy, {})).toBe(false);
		expect(proxiedFraming(relayed, proxy, on)).toBe(false);
		expect(
			proxiedFraming(here, { pattern: 'https://{port}.example.dev', source: 'configured' }, on)
		).toBe(false);
		expect(proxiedFraming(here, null, on)).toBe(false);
	});
});

/** A server on loopback, closed after the tests. */
async function listen(server: http.Server): Promise<number> {
	await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
	return (server.address() as AddressInfo).port;
}

function get(
	port: number,
	path: string,
	headers: Record<string, string> = {}
): Promise<{ status: number; headers: IncomingHttpHeaders; body: string }> {
	return new Promise((resolve, reject) => {
		const req = http.request(
			{ host: '127.0.0.1', port, path, headers: { host: `127.0.0.1:${port}`, ...headers } },
			(res) => {
				let body = '';
				res.on('data', (c) => (body += c));
				res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
			}
		);
		req.on('error', reject);
		req.end();
	});
}

describe('the preview proxy, serving a preview on Wheelhouse’s origin', () => {
	const env: Record<string, string | undefined> = {
		WHEELHOUSE_PREVIEW_PROXY: 'on',
		WHEELHOUSE_ALLOWED_HOSTS: '*.example.dev'
	};
	const seen: IncomingHttpHeaders[] = [];
	// The preview: a page that refuses framing, a redirect, and a dev server's WebSocket.
	const preview = http.createServer((req, res) => {
		seen.push(req.headers);
		if (req.url === '/go') {
			res.writeHead(302, { location: `http://127.0.0.1:${previewPort}/there` });
			return res.end();
		}
		res.writeHead(200, {
			'content-type': 'text/html',
			'x-frame-options': 'DENY',
			'content-security-policy': "default-src 'self'"
		});
		res.end(`<p>preview at ${req.url}</p>`);
	});
	const sockets = new WebSocketServer({ server: preview });
	sockets.on('connection', (ws, req) => {
		seen.push(req.headers);
		ws.send(`hello ${req.url}`);
		ws.on('message', (m) => ws.send(`echo ${m}`));
	});
	const wheelhouse = http.createServer();
	let previewPort = 0;
	let wheelhousePort = 0;
	let proxy: PreviewProxy;

	beforeAll(async () => {
		previewPort = await listen(preview);
		proxy = new PreviewProxy({
			env,
			// Wheelhouse's own port is never served, even when it is among the shown ones.
			shownPorts: async () => [previewPort, wheelhousePort],
			ownPorts: async () => [4310]
		});
		wheelhouse.on('request', (req, res) => {
			if (!proxy.request(req, res)) {
				res.writeHead(200);
				res.end('wheelhouse');
			}
		});
		wheelhouse.on('upgrade', (req, socket, head) => {
			if (!proxy.upgrade(req, socket, head)) socket.destroy();
		});
		wheelhousePort = await listen(wheelhouse);
	});
	afterAll(async () => {
		sockets.close();
		wheelhouse.closeAllConnections();
		preview.closeAllConnections();
		await new Promise((r) => wheelhouse.close(r));
		await new Promise((r) => preview.close(r));
	});

	it('serves the preview with no X-Frame-Options and the sandbox policy', async () => {
		const res = await get(wheelhousePort, `/_p/${previewPort}/app?x=1`, {
			host: '4310--x.example.dev'
		});
		expect(res.status).toBe(200);
		expect(res.body).toBe('<p>preview at /app?x=1</p>');
		expect(res.headers['x-frame-options']).toBeUndefined();
		expect(res.headers['content-security-policy']).toContain('sandbox allow-scripts');
		expect(res.headers['content-security-policy']).toContain("default-src 'self'");
		// The preview saw its own loopback Host, and none of Wheelhouse's headers.
		expect(seen.at(-1)?.host).toBe(`127.0.0.1:${previewPort}`);
	});

	it('sends a bare /_p/<port> to its root, and rewrites the preview’s redirects', async () => {
		const bare = await get(wheelhousePort, `/_p/${previewPort}`);
		expect(bare.status).toBe(308);
		expect(bare.headers.location).toBe(`/_p/${previewPort}/`);
		const go = await get(wheelhousePort, `/_p/${previewPort}/go`);
		expect(go.status).toBe(302);
		expect(go.headers.location).toBe(`/_p/${previewPort}/there`);
	});

	it('answers 404 for a port it does not show, Wheelhouse’s own, and anything else under /_p/', async () => {
		for (const path of [
			'/_p/22/',
			'/_p/4310/',
			`/_p/${wheelhousePort}/`,
			`/_p/${previewPort + 1}/`,
			'/_p/x/'
		]) {
			expect((await get(wheelhousePort, path)).status, path).toBe(404);
		}
	});

	it('answers 421 for a Host Wheelhouse does not answer', async () => {
		for (const host of ['evil.com', 'example.dev', `127.0.0.1.evil.com:${wheelhousePort}`]) {
			const res = await get(wheelhousePort, `/_p/${previewPort}/`, { host });
			expect(res.status, host).toBe(421);
		}
	});

	it('carries a dev server’s WebSocket, with its own Host', async () => {
		const ws = new WebSocket(`ws://127.0.0.1:${wheelhousePort}/_p/${previewPort}/hmr?t=1`, {
			headers: { host: '4310--x.example.dev', origin: 'https://4310--x.example.dev' }
		});
		const got: string[] = [];
		await new Promise<void>((resolve, reject) => {
			ws.on('message', (m) => {
				got.push(String(m));
				if (got.length === 1) ws.send('ping');
				else resolve();
			});
			ws.on('error', reject);
		});
		ws.close();
		expect(got).toEqual(['hello /hmr?t=1', 'echo ping']);
		const upgrade = seen.at(-1);
		expect(upgrade?.host).toBe(`127.0.0.1:${previewPort}`);
		expect(upgrade?.origin).toBe(`http://127.0.0.1:${previewPort}`);
	});

	it('refuses a WebSocket to a port it does not show', async () => {
		const ws = new WebSocket(`ws://127.0.0.1:${wheelhousePort}/_p/4310/`);
		const status = await new Promise<number>((resolve) => {
			ws.on('unexpected-response', (_req, res) => resolve(res.statusCode ?? 0));
			ws.on('error', () => resolve(-1));
		});
		expect(status).toBe(404);
	});

	it('says when nothing answers on a port it may open', async () => {
		const closed = http.createServer();
		const port = await listen(closed);
		await new Promise((r) => closed.close(r));
		const p = new PreviewProxy({ env, shownPorts: async () => [port], ownPorts: async () => [] });
		const s = http.createServer((req, res) => p.request(req, res));
		const at = await listen(s);
		try {
			expect((await get(at, `/_p/${port}/`)).status).toBe(502);
		} finally {
			await new Promise((r) => s.close(r));
		}
	});
});

describe('with the preview proxy off (the default)', () => {
	it('takes no request, so /_p/ is Wheelhouse’s own 404 as before', () => {
		for (const env of [{}, { WHEELHOUSE_PREVIEW_PROXY: 'off' }]) {
			const proxy = new PreviewProxy({
				env,
				shownPorts: async () => [8790],
				ownPorts: async () => []
			});
			const req = { url: '/_p/8790/', headers: { host: '127.0.0.1:4310' } } as http.IncomingMessage;
			expect(proxy.request(req, {} as http.ServerResponse)).toBe(false);
			expect(proxy.upgrade(req, {} as never, Buffer.alloc(0))).toBe(false);
		}
	});
});
