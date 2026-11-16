import { describe, expect, it, vi } from 'vitest';
import { sessionToken } from '$lib/server/session';

const state = vi.hoisted(() => ({ runtime: null as unknown }));
vi.mock('$lib/server/runtime', () => ({ getRuntime: async () => state.runtime }));

const { GET } = await import('./+server');

const output = {
	available: true,
	reason: null,
	lines: ['private worker terminal output'],
	capturedAt: '2026-11-15T13:00:00Z',
	requested: 40
};
const find = vi.fn(() => ({ ok: true }));
const read = vi.fn(async () => output);
state.runtime = {
	configured: true,
	collector: { getFleet: () => ({ tasks: [] }) },
	mateTasks: { find, output: read }
};

async function get(token?: string) {
	const url = new URL('http://127.0.0.1:4310/api/tasks/tk-1%40tokyo/output?lines=40');
	const request = new Request(url, {
		headers: token ? { 'x-wheelhouse-session': token } : {}
	});
	return GET({
		params: { id: 'tk-1@tokyo' },
		url,
		request
	} as unknown as Parameters<typeof GET>[0]);
}

describe('GET /api/tasks/[id]/output', () => {
	it('does not read remote worker output without this launch’s session token', async () => {
		for (const token of [undefined, 'wrong-token']) {
			await expect(get(token)).rejects.toMatchObject({ status: 403 });
		}
		expect(find).not.toHaveBeenCalled();
		expect(read).not.toHaveBeenCalled();
	});

	it('returns a remote worker sample to an authenticated caller', async () => {
		const response = await get(sessionToken());
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual(output);
		expect(find).toHaveBeenCalledWith('tk-1@tokyo');
		expect(read).toHaveBeenCalledWith('tk-1@tokyo', 40);
	});
});
