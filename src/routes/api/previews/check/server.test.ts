import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { RequestEvent } from '@sveltejs/kit';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const shown = vi.hoisted(() => ({ addresses: [] as string[] }));
vi.mock('$lib/server/runtime', () => ({
	getRuntime: async () => ({ configured: true, seen: { list: async () => shown.addresses } })
}));

const { GET } = await import('./+server');

let server: Server;
let live: string;

beforeAll(async () => {
	server = createServer((_req, res) => res.end('ok'));
	await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
	live = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
	shown.addresses = [`${live}/session/ab12`];
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

const get = async (address: string) => {
	const url = new URL(
		`http://127.0.0.1:4310/api/previews/check?url=${encodeURIComponent(address)}`
	);
	const event = { url, request: new Request(url) } as unknown as RequestEvent;
	const res = await GET(event as Parameters<typeof GET>[0]);
	return { status: res.status, body: await res.json() };
};

describe('GET /api/previews/check', () => {
	it('checks a preview no task reported, at an address Wheelhouse has shown', async () => {
		const r = await get(`${live}/`);
		expect(r.status).toBe(200);
		expect(r.body).toMatchObject({
			url: `${live}/`,
			state: 'live',
			reason: null,
			reportedAt: null
		});
	});

	it('never fetches an address Wheelhouse has not shown, or one off this computer', async () => {
		expect((await get('http://127.0.0.1:1/')).status).toBe(404);
		expect((await get('https://example.com/')).status).toBe(400);
		expect((await get('not a url')).status).toBe(400);
	});
});
