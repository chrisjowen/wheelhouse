import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { RequestEvent } from '@sveltejs/kit';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const fleet = vi.hoisted(() => ({ tasks: [] as { id: string; preview: unknown }[] }));
vi.mock('$lib/server/runtime', () => ({ currentFleet: async () => fleet }));

const { GET } = await import('./+server');

let server: Server;

beforeAll(async () => {
	server = createServer((_req, res) => {
		res.setHeader('content-security-policy', 'frame-ancestors https://127.0.0.1:*');
		res.end('ok');
	});
	await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
	const port = (server.address() as AddressInfo).port;
	fleet.tasks = [
		{
			id: 'wh-1',
			preview: { url: `http://127.0.0.1:${port}/`, reportedAt: '2026-10-25T10:00:00.000Z' }
		}
	];
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe('GET /api/tasks/[id]/preview', () => {
	it('judges framing against the http page Wheelhouse served, not adapter-node’s https url', async () => {
		const url = new URL('https://127.0.0.1:4310/api/tasks/wh-1/preview');
		const event = {
			params: { id: 'wh-1' },
			url,
			request: new Request(url, { headers: { host: '127.0.0.1:4310' } })
		} as unknown as RequestEvent;
		const res = await GET(event as Parameters<typeof GET>[0]);
		const body = await res.json();
		expect(body.state).toBe('blocked');
		expect(body.reason).toMatch(/frame-ancestors/);
	});
});
