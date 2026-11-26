import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { RequestEvent } from '@sveltejs/kit';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const fleet = vi.hoisted(() => ({
	tasks: [] as { id: string; status?: string; preview: unknown }[]
}));
vi.mock('$lib/server/runtime', () => ({
	currentFleet: async () => fleet,
	framesThroughProxy: () => false
}));

const { GET } = await import('./+server');
const { CLOSED, STOPPED } = await import('$lib/server/preview');

let server: Server;

beforeAll(async () => {
	server = createServer((_req, res) => {
		res.setHeader('content-security-policy', 'frame-ancestors https://127.0.0.1:*');
		res.end('ok');
	});
	await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
	const port = (server.address() as AddressInfo).port;
	const gone = createServer();
	await new Promise<void>((r) => gone.listen(0, '127.0.0.1', r));
	const stopped = `http://127.0.0.1:${(gone.address() as AddressInfo).port}/`;
	await new Promise<void>((r) => gone.close(() => r()));
	const reportedAt = '2026-10-25T10:00:00.000Z';
	fleet.tasks = [
		{ id: 'wh-1', preview: { url: `http://127.0.0.1:${port}/`, reportedAt } },
		{ id: 'wh-2', status: 'working', preview: { url: stopped, reportedAt } },
		{ id: 'wh-3', status: 'landed', preview: { url: stopped, reportedAt } }
	];
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

const get = async (id: string) => {
	const url = new URL(`http://127.0.0.1:4310/api/tasks/${id}/preview`);
	const event = { params: { id }, url, request: new Request(url) } as unknown as RequestEvent;
	return (await GET(event as Parameters<typeof GET>[0])).json();
};

describe('GET /api/tasks/[id]/preview', () => {
	it('says a preview that does not answer has stopped, and that landed work has closed it', async () => {
		expect(await get('wh-2')).toMatchObject({ state: 'down', reason: STOPPED });
		expect(await get('wh-3')).toMatchObject({ state: 'down', reason: CLOSED });
	});

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
