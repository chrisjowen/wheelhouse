import { createServer, request, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket, WebSocketServer } from 'ws';
import { hostOnlyCookie, LocalProxy, requestHeaders, rewriteLocation } from './proxy';

/**
 * The localhost proxy against a real app on loopback: a page with a root-path
 * asset, a client-side route, a redirect to its own address, a cookie, a form
 * post and a WebSocket (as Vite's HMR uses), all reached through a server
 * that hands requests to the proxy as Wheelhouse's does.
 */

const listen = (server: Server) =>
	new Promise<number>((resolve) =>
		server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port))
	);

let app: Server;
let appPort: number;
let wss: WebSocketServer;
let front: Server;
let frontPort: number;
let settings: Record<string, unknown> | null;
let reported: Set<number>;
let reserved: number[];
/** The headers the app last saw. */
let seen: IncomingHttpHeaders;

beforeAll(async () => {
	app = createServer((req, res) => {
		seen = req.headers;
		if (req.url === '/') {
			res.writeHead(200, { 'content-type': 'text/html' });
			res.end('<script type="module" src="/@vite/client"></script><h1>Lumen</h1>');
		} else if (req.url === '/@vite/client') {
			res.writeHead(200, { 'content-type': 'text/javascript' });
			res.end('new WebSocket(`ws://${location.host}/`, "vite-hmr")');
		} else if (req.url === '/login') {
			res.writeHead(302, {
				location: `http://localhost:${appPort}/dashboard?next=1`,
				'set-cookie': ['sid=abc; Path=/; Domain=localhost; HttpOnly', 'theme=dark; Path=/']
			});
			res.end();
		} else if (req.method === 'POST') {
			let body = '';
			req.on('data', (c) => (body += c));
			req.on('end', () => {
				res.writeHead(200, { 'content-type': 'text/plain' });
				res.end(`got ${body}`);
			});
		} else {
			// Any other path is a client-side route: the app's shell answers it.
			res.writeHead(200, { 'content-type': 'text/html' });
			res.end(`<h1>Lumen</h1><p>route ${req.url}</p>`);
		}
	});
	wss = new WebSocketServer({ server: app });
	wss.on('connection', (ws, req) => {
		ws.send(`hello ${req.headers.origin} ${req.headers.host}`);
		ws.on('message', (m) => ws.send(`echo ${m}`));
	});
	appPort = await listen(app);

	const proxy = new LocalProxy({
		settings: async () => settings,
		reported: async (port) => reported.has(port),
		reserved: () => reserved,
		targets: ['127.0.0.1']
	});
	front = createServer((req, res) => {
		if (!proxy.request(req, res)) {
			res.writeHead(200);
			res.end('wheelhouse');
		}
	});
	front.on('upgrade', (req, socket, head) => {
		if (!proxy.upgrade(req, socket, head)) socket.destroy();
	});
	frontPort = await listen(front);
});

afterAll(() => {
	wss.close();
	app.close();
	app.closeAllConnections();
	front.close();
	front.closeAllConnections();
});

beforeEach(() => {
	settings = {};
	reported = new Set([appPort]);
	reserved = [];
});

const hostFor = (port: number) => `${port}.localhost:${frontPort}`;
const originFor = (port: number) => `http://${hostFor(port)}`;

function get(
	path: string,
	opts: { host?: string; method?: string; headers?: Record<string, string>; body?: string } = {}
): Promise<{ status: number; headers: IncomingHttpHeaders; body: string }> {
	return new Promise((resolve, reject) => {
		const req = request(
			{
				host: '127.0.0.1',
				port: frontPort,
				path,
				method: opts.method ?? 'GET',
				headers: { host: opts.host ?? hostFor(appPort), ...opts.headers }
			},
			(res) => {
				let body = '';
				res.on('data', (c) => (body += c));
				res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers, body }));
			}
		);
		req.on('error', reject);
		req.end(opts.body);
	});
}

function socket(origin: string, host = hostFor(appPort)): Promise<string[]> {
	return new Promise((resolve, reject) => {
		const ws = new WebSocket(`ws://127.0.0.1:${frontPort}/`, 'vite-hmr', {
			headers: { host },
			origin
		});
		const got: string[] = [];
		ws.on('message', (m) => {
			got.push(String(m));
			if (got.length === 1) ws.send('ping');
			else ws.close();
		});
		ws.on('close', () => resolve(got));
		ws.on('unexpected-response', (_req, res) => reject(new Error(`refused ${res.statusCode}`)));
		ws.on('error', reject);
	});
}

describe('a proxied page', () => {
	it('serves the app’s HTML, root-path assets and client-side routes on its own origin', async () => {
		const page = await get('/');
		expect(page.status).toBe(200);
		expect(page.body).toContain('<h1>Lumen</h1>');
		// The app sees its own address, as it would without the proxy.
		expect(seen.host).toBe(`localhost:${appPort}`);
		const asset = await get('/@vite/client');
		expect(asset.headers['content-type']).toBe('text/javascript');
		expect((await get('/projects/7?tab=a')).body).toContain('route /projects/7?tab=a');
	});

	it('rewrites a redirect to the app’s own address, and keeps its cookies to the proxied one', async () => {
		const r = await get('/login');
		expect(r.status).toBe(302);
		expect(r.headers.location).toBe(`${originFor(appPort)}/dashboard?next=1`);
		expect(r.headers['set-cookie']).toEqual(['sid=abc; Path=/; HttpOnly', 'theme=dark; Path=/']);
	});

	it('passes a post from the page’s own origin, which the app sees as its own', async () => {
		const r = await get('/save', {
			method: 'POST',
			headers: { origin: originFor(appPort), 'content-type': 'text/plain' },
			body: 'draft'
		});
		expect(r).toMatchObject({ status: 200, body: 'got draft' });
		expect(seen.origin).toBe(`http://localhost:${appPort}`);
	});

	it('carries a WebSocket both ways, as Vite’s HMR uses one', async () => {
		expect(await socket(originFor(appPort))).toEqual([
			`hello http://localhost:${appPort} localhost:${appPort}`,
			'echo ping'
		]);
	});
});

describe('what the proxy refuses', () => {
	it('answers nothing it does not own: Wheelhouse’s own hosts go to Wheelhouse', async () => {
		expect((await get('/', { host: `localhost:${frontPort}` })).body).toBe('wheelhouse');
		expect((await get('/', { host: `${appPort}.localhost.evil.test` })).body).toBe('wheelhouse');
	});

	it('refuses everything while the plugin is off, as Wheelhouse refuses a foreign Host', async () => {
		settings = null;
		expect(await get('/')).toMatchObject({ status: 421, body: 'Misdirected request' });
		await expect(socket(originFor(appPort))).rejects.toThrow('refused 421');
	});

	it('opens only ports the crew reported, or the settings list', async () => {
		reported = new Set();
		const r = await get('/');
		expect(r.status).toBe(403);
		expect(r.headers['content-type']).toContain('text/html');
		expect(r.body).toContain(`Nothing has reported port ${appPort}`);
		expect(r.body).toContain('More ports to allow');
		await expect(socket(originFor(appPort))).rejects.toThrow('refused 403');

		settings = { ports: [String(appPort)] };
		expect((await get('/')).status).toBe(200);
	});

	it('never opens Wheelhouse’s own port or a reserved one, even when listed', async () => {
		settings = { ports: [String(frontPort), String(appPort)] };
		const own = await get('/', { host: hostFor(frontPort) });
		expect(own.status).toBe(403);
		expect(own.body).toContain('Wheelhouse’s own');
		reserved = [appPort];
		expect((await get('/')).status).toBe(403);
	});

	it('refuses a change or a WebSocket from any other origin', async () => {
		const evil = await get('/save', {
			method: 'POST',
			headers: { origin: 'http://evil.test' },
			body: 'x'
		});
		expect(evil).toMatchObject({
			status: 403,
			body: 'Requests from http://evil.test are not accepted.'
		});
		const none = await get('/save', { method: 'POST', body: 'x' });
		expect(none.status).toBe(403);
		// Another proxied app is another origin too.
		const sibling = await get('/save', {
			method: 'POST',
			headers: { origin: originFor(appPort + 1) },
			body: 'x'
		});
		expect(sibling.status).toBe(403);
		await expect(socket('http://evil.test')).rejects.toThrow('refused 403');
	});

	it('says so plainly when nothing answers on the port', async () => {
		const down = new Set([1]);
		reported = down;
		const r = await get('/', { host: hostFor(1) });
		expect(r.status).toBe(502);
		expect(r.body).toContain('nothing answered on that port');
	});
});

describe('header rewriting', () => {
	it('passes the app its own address and drops hop-by-hop headers', () => {
		const host = '5173.localhost:4310';
		expect(
			requestHeaders(
				{
					host,
					origin: 'http://5173.localhost:4310',
					referer: 'http://5173.localhost:4310/a?b=1',
					connection: 'keep-alive, x-secret',
					'x-secret': 'hop',
					'proxy-authorization': 'Basic x',
					accept: 'text/html'
				},
				5173,
				host,
				false
			)
		).toEqual({
			host: 'localhost:5173',
			origin: 'http://localhost:5173',
			referer: 'http://localhost:5173/a?b=1',
			accept: 'text/html'
		});
	});

	it('keeps a foreign Origin as it is, so the app can refuse it too', () => {
		const out = requestHeaders({ origin: 'http://evil.test' }, 5173, '5173.localhost:4310', false);
		expect(out.origin).toBe('http://evil.test');
	});

	it('rewrites redirects on this computer only', () => {
		const host = '5173.localhost:4310';
		expect(rewriteLocation('http://127.0.0.1:5173/x', host)).toBe('http://5173.localhost:4310/x');
		expect(rewriteLocation('/relative', host)).toBe('/relative');
		expect(rewriteLocation('https://github.com/login', host)).toBe('https://github.com/login');
	});

	it('drops a cookie’s Domain', () => {
		expect(hostOnlyCookie('a=1; Domain=.localhost; Path=/')).toBe('a=1; Path=/');
		expect(hostOnlyCookie('a=1;domain=localhost')).toBe('a=1');
	});
});
