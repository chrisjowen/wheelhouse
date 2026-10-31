import { createServer, request, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket, WebSocketServer } from 'ws';
import type { HostRoute, HostRouteContext } from '../plugins/types';
import { HostRouter, type HostMatch } from './router';

/**
 * The host router in front of a server as Wheelhouse's is: requests for a
 * `*.localhost` name reach the plugin route that answers it, with core's
 * guards; any other host reaches Wheelhouse.
 */

let server: Server;
let port: number;
let match: HostMatch | null;
let seenCtx: HostRouteContext | null;
const wss = new WebSocketServer({ noServer: true });
wss.on('connection', (ws) => ws.on('message', (m) => ws.send(`echo ${m}`)));

const route: HostRoute = {
	id: 'echo',
	host: '{port}.localhost',
	request(req, res, ctx) {
		seenCtx = ctx;
		let body = '';
		req.on('data', (c) => (body += c));
		req.on('end', () => {
			res.writeHead(200, { 'content-type': 'text/plain' });
			res.end(`${req.method} ${req.url} for ${ctx.port}${body ? `: ${body}` : ''}`);
		});
	},
	upgrade(req, socket, head) {
		wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
	}
};

beforeAll(async () => {
	const hosts = new HostRouter({
		route: async (hostname) => (hostname.endsWith('.localhost') && match ? match : null),
		loopbackAddresses: async () => ['http://localhost:5173/'],
		reservedPorts: () => [9999]
	});
	server = createServer((req, res) => {
		if (!hosts.request(req, res)) {
			res.writeHead(200);
			res.end('wheelhouse');
		}
	});
	server.on('upgrade', (req, socket, head) => {
		if (!hosts.upgrade(req, socket, head)) socket.destroy();
	});
	await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
	port = (server.address() as AddressInfo).port;
});
afterAll(() => {
	wss.close();
	server.close();
	server.closeAllConnections();
});
beforeEach(() => {
	match = { plugin: 'echo-plugin', route, port: 5173, settings: { a: 1 } };
	seenCtx = null;
});

const host = `5173.localhost:${0}`;
const hostAt = () => host.replace(':0', `:${port}`);

function send(
	path: string,
	o: { host?: string; method?: string; headers?: Record<string, string>; body?: string } = {}
): Promise<{ status: number; headers: IncomingHttpHeaders; body: string }> {
	return new Promise((resolve, reject) => {
		const req = request(
			{
				host: '127.0.0.1',
				port,
				path,
				method: o.method ?? 'GET',
				headers: { host: o.host ?? hostAt(), ...o.headers }
			},
			(res) => {
				let body = '';
				res.on('data', (c) => (body += c));
				res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers, body }));
			}
		);
		req.on('error', reject);
		req.end(o.body);
	});
}

function socket(origin: string | undefined): Promise<string> {
	return new Promise((resolve, reject) => {
		const ws = new WebSocket(`ws://127.0.0.1:${port}/live`, {
			headers: { host: hostAt() },
			...(origin ? { origin } : {})
		});
		ws.on('open', () => ws.send('ping'));
		ws.on('message', (m) => {
			resolve(String(m));
			ws.close();
		});
		ws.on('unexpected-response', (_q, r) => reject(new Error(`refused ${r.statusCode}`)));
		ws.on('error', reject);
	});
}

describe('HostRouter', () => {
	it('hands a request for a claimed host to its route, with what the route may read', async () => {
		expect(await send('/app?x=1')).toMatchObject({ status: 200, body: 'GET /app?x=1 for 5173' });
		expect(seenCtx).toMatchObject({
			host: hostAt(),
			origin: `http://${hostAt()}`,
			port: 5173,
			settings: { a: 1 }
		});
		expect(await seenCtx!.loopbackAddresses()).toEqual(['http://localhost:5173/']);
		// The port the request came in on is Wheelhouse's own.
		expect(seenCtx!.reservedPorts().sort()).toEqual([port, 9999].sort());
	});

	it('leaves every other host to Wheelhouse', async () => {
		expect((await send('/', { host: `localhost:${port}` })).body).toBe('wheelhouse');
		expect((await send('/', { host: `5173.localhost.evil.test` })).body).toBe('wheelhouse');
	});

	it('refuses a host nothing answers, or whose plugin is off, as any foreign Host is refused', async () => {
		match = null;
		expect(await send('/')).toMatchObject({ status: 421, body: 'Misdirected request' });
		await expect(socket(`http://${hostAt()}`)).rejects.toThrow('refused 421');
	});

	it('passes a change only from the host’s own page', async () => {
		const own = { origin: `http://${hostAt()}` };
		expect(await send('/save', { method: 'POST', headers: own, body: 'draft' })).toMatchObject({
			status: 200,
			body: 'POST /save for 5173: draft'
		});
		expect(
			await send('/save', { method: 'POST', headers: { origin: 'http://evil.test' }, body: 'x' })
		).toMatchObject({ status: 403, body: 'Requests from http://evil.test are not accepted.' });
		const sibling = { origin: `http://3000.localhost:${port}` };
		expect((await send('/save', { method: 'DELETE', headers: sibling })).status).toBe(403);
		expect((await send('/save', { method: 'POST', body: 'x' })).status).toBe(403);
	});

	it('carries a WebSocket from the host’s own page, and refuses one from anywhere else', async () => {
		expect(await socket(`http://${hostAt()}`)).toBe('echo ping');
		await expect(socket('http://evil.test')).rejects.toThrow('refused 403');
		await expect(socket(undefined)).rejects.toThrow('refused 403');
		match = { ...match!, route: { ...route, upgrade: undefined } };
		await expect(socket(`http://${hostAt()}`)).rejects.toThrow('refused 404');
	});

	function broken(
		failing: Pick<HostRoute, 'request' | 'upgrade'>,
		logged: string[]
	): Promise<{ server: Server; port: number }> {
		const hosts = new HostRouter({
			route: async () => ({
				plugin: 'broken',
				route: { id: 'boom', host: '{port}.localhost', ...failing },
				port: 1,
				settings: {}
			}),
			loopbackAddresses: async () => [],
			reservedPorts: () => [],
			log: (m) => logged.push(m)
		});
		const s = createServer((req, res) => void hosts.request(req, res));
		s.on('upgrade', (req, socket, head) => void hosts.upgrade(req, socket, head));
		return new Promise((r) =>
			s.listen(0, '127.0.0.1', () => r({ server: s, port: (s.address() as AddressInfo).port }))
		);
	}

	it.each([
		[
			'throws',
			() => {
				throw new Error('boom');
			}
		],
		['rejects', async () => Promise.reject(new Error('boom'))]
	])('answers for a route that %s, and logs which plugin it was', async (_, fail) => {
		const logged: string[] = [];
		const { server: s, port: p } = await broken({ request: fail }, logged);
		const status = await new Promise<number | undefined>((resolve, reject) => {
			const req = request(
				{ host: '127.0.0.1', port: p, headers: { host: `1.localhost:${p}` } },
				(res) => {
					res.resume();
					resolve(res.statusCode);
				}
			);
			req.on('error', reject);
			req.end();
		});
		s.close();
		expect(status).toBe(500);
		expect(logged).toEqual(['Plugin broken: host route "boom" failed: boom']);
	});

	it('closes the socket of a WebSocket whose route rejects, and logs which plugin it was', async () => {
		const logged: string[] = [];
		const { server: s, port: p } = await broken(
			{ request() {}, upgrade: async () => Promise.reject(new Error('boom')) },
			logged
		);
		const closed = await new Promise<string>((resolve) => {
			const ws = new WebSocket(`ws://127.0.0.1:${p}/live`, {
				headers: { host: `1.localhost:${p}` },
				origin: `http://1.localhost:${p}`
			});
			ws.on('open', () => resolve('open'));
			ws.on('error', () => resolve('closed'));
		});
		s.close();
		expect(closed).toBe('closed');
		expect(logged).toEqual(['Plugin broken: host route "boom" failed: boom']);
	});
});
