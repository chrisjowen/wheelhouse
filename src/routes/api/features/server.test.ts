import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { REMOTES_LOCAL_ONLY } from '$lib/server/cloud/remote';
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

async function post(body: unknown, headers: Record<string, string> = {}) {
	return POST({
		request: new Request('http://127.0.0.1:4310/api/features', {
			method: 'POST',
			headers: { 'content-type': 'application/json', ...headers },
			body: JSON.stringify(body)
		})
	} as never);
}

describe('/api/features', () => {
	it('reports feature defaults and persists changes without removing other flags', async () => {
		const initial = await (await GET({} as never)).json();
		expect(initial).toEqual({
			saved: {
				events: false,
				remotes: false,
				'hosted-second-mates': false,
				discussion: false,
				lanes: false,
				livereview: false,
				soundings: false,
				automaticProviderSwitching: true
			},
			enabled: {
				events: false,
				remotes: false,
				'hosted-second-mates': false,
				discussion: false,
				lanes: false,
				livereview: false,
				soundings: false,
				automaticProviderSwitching: true
			}
		});

		const first = await post({ feature: 'events', enabled: true });
		expect(first.status).toBe(200);
		const firstBody = await first.json();
		expect(firstBody.saved).toEqual({
			events: true,
			remotes: false,
			'hosted-second-mates': false,
			discussion: false,
			lanes: false,
			livereview: false,
			soundings: false,
			automaticProviderSwitching: true
		});
		expect(firstBody.enabled).toEqual({
			events: true,
			remotes: false,
			'hosted-second-mates': false,
			discussion: false,
			lanes: false,
			livereview: false,
			soundings: false,
			automaticProviderSwitching: true
		});

		const second = await post({ feature: 'remotes', enabled: true });
		expect((await second.json()).saved).toEqual({
			events: true,
			remotes: true,
			'hosted-second-mates': false,
			discussion: false,
			lanes: false,
			livereview: false,
			soundings: false,
			automaticProviderSwitching: true
		});
	});

	it('rejects unknown feature names and non-boolean values', async () => {
		expect((await post({ feature: 'unknown', enabled: true })).status).toBe(400);
		expect((await post({ feature: 'events', enabled: 'yes' })).status).toBe(400);
	});

	it('refuses to change remotes through the relay but still lets events change there', async () => {
		const relayed = { 'x-wheelhouse-remote': '1' };
		const refused = await post({ feature: 'remotes', enabled: true }, relayed);
		expect(refused.status).toBe(403);
		expect((await refused.json()).message).toBe(REMOTES_LOCAL_ONLY);
		expect((await (await GET({} as never)).json()).saved).toEqual({
			events: false,
			remotes: false,
			'hosted-second-mates': false,
			discussion: false,
			lanes: false,
			livereview: false,
			soundings: false,
			automaticProviderSwitching: true
		});

		const events = await post({ feature: 'events', enabled: true }, relayed);
		expect(events.status).toBe(200);
		expect((await events.json()).saved).toEqual({
			events: true,
			remotes: false,
			'hosted-second-mates': false,
			discussion: false,
			lanes: false,
			livereview: false,
			soundings: false,
			automaticProviderSwitching: true
		});
	});

	it('changes automatic switching immediately without requesting a restart', async () => {
		const response = await post({ feature: 'automaticProviderSwitching', enabled: false });
		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({
			saved: { automaticProviderSwitching: false },
			enabled: { automaticProviderSwitching: false },
			restartRequired: false
		});
	});

	it('turns chat lanes on without a restart: the page reads the flag on its next load', async () => {
		const response = await post({ feature: 'lanes', enabled: true });
		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({
			saved: { lanes: true },
			enabled: { lanes: true },
			restartRequired: false
		});
	});
});
