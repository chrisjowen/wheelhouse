import { describe, expect, it, vi } from 'vitest';
import { sessionToken } from '$lib/server/session';

const state = vi.hoisted(() => ({ runtime: null as unknown }));
vi.mock('$lib/server/runtime', () => ({ getRuntime: async () => state.runtime }));

const { GET } = await import('./+server');

const mate = { id: 'tokyo' };
const peek = {
	available: true,
	offline: false,
	reason: null,
	lines: ['private terminal output'],
	capturedAt: '2026-11-15T13:00:00Z',
	requested: 40
};
const look = vi.fn(async () => peek);
state.runtime = {
	configured: true,
	collector: { getFleet: () => ({ secondMates: [mate] }) },
	matePeeks: { look }
};

async function get(token?: string) {
	const url = new URL('http://127.0.0.1:4310/api/second-mates/tokyo/peek?lines=40');
	const request = new Request(url, {
		headers: token ? { 'x-wheelhouse-session': token } : {}
	});
	return GET({
		params: { id: 'tokyo' },
		url,
		request
	} as unknown as Parameters<typeof GET>[0]);
}

describe('GET /api/second-mates/[id]/peek', () => {
	it('does not read terminal output without this launch’s session token', async () => {
		for (const token of [undefined, 'wrong-token']) {
			await expect(get(token)).rejects.toMatchObject({ status: 403 });
		}
		expect(look).not.toHaveBeenCalled();
	});

	it('returns a requested terminal sample to an authenticated caller', async () => {
		const response = await get(sessionToken());
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual(peek);
		expect(look).toHaveBeenCalledWith(mate, 40);
	});
});
