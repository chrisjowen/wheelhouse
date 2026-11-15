import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GET, POST } from './+server';

let configDir = '';
let previous: string | undefined;

beforeEach(async () => {
	previous = process.env.WHEELHOUSE_CONFIG_DIR;
	configDir = await mkdtemp(path.join(os.tmpdir(), 'wheelhouse-feature-api-'));
	process.env.WHEELHOUSE_CONFIG_DIR = configDir;
	delete process.env.WHEELHOUSE_ENABLE_FEATURES;
});

afterEach(async () => {
	if (previous === undefined) delete process.env.WHEELHOUSE_CONFIG_DIR;
	else process.env.WHEELHOUSE_CONFIG_DIR = previous;
	delete process.env.WHEELHOUSE_ENABLE_FEATURES;
	await rm(configDir, { recursive: true, force: true });
});

async function post(body: unknown) {
	return POST({
		request: new Request('http://127.0.0.1:4310/api/features', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		})
	} as never);
}

describe('/api/features', () => {
	it('reports both features off by default and persists changes without removing other flags', async () => {
		const initial = await (await GET({} as never)).json();
		expect(initial).toEqual({
			saved: { events: false, remotes: false },
			enabled: { events: false, remotes: false }
		});

		const first = await post({ feature: 'events', enabled: true });
		expect(first.status).toBe(200);
		const firstBody = await first.json();
		expect(firstBody.saved).toEqual({ events: true, remotes: false });
		expect(firstBody.enabled).toEqual({ events: true, remotes: false });

		const second = await post({ feature: 'remotes', enabled: true });
		expect((await second.json()).saved).toEqual({ events: true, remotes: true });
	});

	it('rejects unknown feature names and non-boolean values', async () => {
		expect((await post({ feature: 'unknown', enabled: true })).status).toBe(400);
		expect((await post({ feature: 'events', enabled: 'yes' })).status).toBe(400);
	});
});
