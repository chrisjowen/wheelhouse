import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer, request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import type { PluginConfig } from '../plugins/config';
import { loadBundledPlugins } from '../plugins/loader';
import { PluginRegistry } from '../plugins/registry';
import { HostRouter } from './router';

/**
 * The example host-route plugin (tests/fixtures/host-route-demo), loaded as
 * Wheelhouse loads a plugin from a folder, reached through the registry and
 * the host router in front of a server as Wheelhouse's is.
 */

let dir: string;
let server: Server;
let port: number;
let plugins: PluginConfig['plugins'] = {};
let reg: PluginRegistry;

beforeAll(async () => {
	dir = mkdtempSync(path.join(tmpdir(), 'wh-host-routes-'));
	cpSync(path.resolve('tests/fixtures/host-route-demo'), path.join(dir, 'host-route-demo'), {
		recursive: true
	});
	const loaded = await loadBundledPlugins(dir);
	expect(loaded.problems).toEqual([]);
	reg = new PluginRegistry(
		[],
		{
			fleet: () => ({ projects: [], tasks: [] }),
			worktree: () => null,
			config: async () => ({ config: { plugins }, error: null })
		},
		{ plugins: loaded.installed }
	);
	const hosts = new HostRouter({
		route: (h) => reg.hostRoute(h),
		loopbackAddresses: async () => ['http://localhost:5173/'],
		reservedPorts: () => []
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
	server.close();
	server.closeAllConnections();
	rmSync(dir, { recursive: true, force: true });
});

const get = (host: string) =>
	new Promise<{ status?: number; body: string }>((resolve, reject) => {
		const req = request({ host: '127.0.0.1', port, path: '/app?x=1', headers: { host } }, (res) => {
			let body = '';
			res.on('data', (c) => (body += c));
			res.on('end', () => resolve({ status: res.statusCode, body }));
		});
		req.on('error', reject);
		req.end();
	});

describe('the example host-route plugin', () => {
	it('declares what it answers and where it shows addresses', () => {
		expect(reg.status()).toEqual([
			expect.objectContaining({
				id: 'host-route-demo',
				state: 'loaded',
				hostRoutes: ['{port}.localhost'],
				addressRewrites: ['{port}.localhost']
			})
		]);
	});

	it('answers its host only while it is on', async () => {
		plugins = {};
		expect(await get(`5173.localhost:${port}`)).toMatchObject({ status: 421 });
		expect(await reg.addressRewrites()).toEqual([]);

		plugins = { 'host-route-demo': { enabled: true, settings: { ports: ['3000'] } } };
		const r = await get(`5173.localhost:${port}`);
		expect(r.status).toBe(200);
		expect(JSON.parse(r.body)).toEqual({
			method: 'GET',
			url: '/app?x=1',
			host: `5173.localhost:${port}`,
			origin: `http://5173.localhost:${port}`,
			port: 5173,
			settings: { ports: ['3000'] },
			loopbackAddresses: ['http://localhost:5173/'],
			reservedPorts: [port]
		});
		expect(await reg.addressRewrites()).toEqual(['{port}.localhost']);
		expect((await get(`localhost:${port}`)).body).toBe('wheelhouse');
	});

	it('echoes a WebSocket from its own page', async () => {
		plugins = { 'host-route-demo': { enabled: true } };
		const host = `5173.localhost:${port}`;
		const reply = await new Promise<string>((resolve, reject) => {
			const ws = new WebSocket(`ws://127.0.0.1:${port}/live`, {
				headers: { host },
				origin: `http://${host}`
			});
			ws.on('open', () => ws.send('ping'));
			ws.on('message', (m) => {
				resolve(String(m));
				ws.terminate();
			});
			ws.on('unexpected-response', (_q, res) => reject(new Error(`refused ${res.statusCode}`)));
			ws.on('error', reject);
		});
		expect(reply).toBe('echo ping on 5173');
	});
});
