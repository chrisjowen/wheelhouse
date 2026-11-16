import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { saveFeatureSettings } from '$lib/server/features';
import { load } from './+page.server';

let configDir = '';
let previousConfigDir: string | undefined;
let previousEnabled: string | undefined;

beforeEach(async () => {
	previousConfigDir = process.env.WHEELHOUSE_CONFIG_DIR;
	previousEnabled = process.env.WHEELHOUSE_ENABLE_FEATURES;
	configDir = await mkdtemp(path.join(os.tmpdir(), 'wheelhouse-settings-redirect-'));
	process.env.WHEELHOUSE_CONFIG_DIR = configDir;
	delete process.env.WHEELHOUSE_ENABLE_FEATURES;
});

afterEach(async () => {
	if (previousConfigDir === undefined) delete process.env.WHEELHOUSE_CONFIG_DIR;
	else process.env.WHEELHOUSE_CONFIG_DIR = previousConfigDir;
	if (previousEnabled === undefined) delete process.env.WHEELHOUSE_ENABLE_FEATURES;
	else process.env.WHEELHOUSE_ENABLE_FEATURES = previousEnabled;
	await rm(configDir, { recursive: true, force: true });
});

describe('/settings redirect', () => {
	it('keeps Settings and Experimental features reachable when remotes is off by default', async () => {
		await expect(load({} as never)).rejects.toMatchObject({
			status: 307,
			location: '/settings/experimental'
		});
	});

	it('opens the Gateway profile when remotes is enabled', async () => {
		await saveFeatureSettings(configDir, {
			events: false,
			remotes: true,
			'hosted-second-mates': false,
			discussion: false,
			automaticProviderSwitching: true
		});
		await expect(load({} as never)).rejects.toMatchObject({
			status: 307,
			location: '/settings/gateway'
		});
	});
});
