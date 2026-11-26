import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ANSWERS_SCHEMA, answersFile } from './setup/answers';
import {
	featureForPath,
	featureSettings,
	parseFeatureList,
	readSavedFeatures,
	saveFeatureSettings
} from './features';

let dir = '';
afterEach(async () => {
	if (dir) await rm(dir, { recursive: true, force: true });
	dir = '';
});

async function configDir() {
	dir = await mkdtemp(path.join(os.tmpdir(), 'wheelhouse-features-'));
	return dir;
}

describe('feature settings', () => {
	it('defaults experimental flags off and provider switching on', async () => {
		const config = await configDir();
		expect(await readSavedFeatures(config)).toEqual({
			events: false,
			remotes: false,
			'hosted-second-mates': false,
			discussion: false,
			lanes: false,
			livereview: false,
			soundings: false,
			automaticProviderSwitching: true
		});
		expect(
			await featureSettings(
				{
					WHEELHOUSE_ENABLE_FEATURES:
						'events,remotes,hosted-second-mates,discussion,lanes,livereview'
				},
				config
			)
		).toEqual({
			events: true,
			remotes: true,
			'hosted-second-mates': true,
			discussion: true,
			lanes: true,
			livereview: true,
			soundings: false,
			automaticProviderSwitching: true
		});
		expect(parseFeatureList('events, events,remotes,hosted-second-mates,discussion')).toEqual([
			'events',
			'remotes',
			'hosted-second-mates',
			'discussion'
		]);
		expect(() => parseFeatureList('events,other')).toThrow('Unknown feature "other"');
		expect(() => parseFeatureList('automaticProviderSwitching')).toThrow(
			'Unknown feature "automaticProviderSwitching"'
		);
	});

	it('defaults remotes on for cloud machines and respects saved choices and launch enables', async () => {
		const config = await configDir();
		await writeFile(
			answersFile(config),
			JSON.stringify({ schema: ANSWERS_SCHEMA, agent: 'claude', auth: 'subscription' })
		);
		expect(await featureSettings({}, config)).toEqual({
			events: false,
			remotes: true,
			'hosted-second-mates': false,
			discussion: false,
			lanes: false,
			livereview: false,
			soundings: false,
			automaticProviderSwitching: true
		});

		await saveFeatureSettings(config, {
			events: false,
			remotes: false,
			'hosted-second-mates': false,
			discussion: false,
			lanes: false,
			livereview: false,
			soundings: false,
			automaticProviderSwitching: false
		});
		expect(await featureSettings({}, config)).toEqual({
			events: false,
			remotes: false,
			'hosted-second-mates': false,
			discussion: false,
			lanes: false,
			livereview: false,
			soundings: false,
			automaticProviderSwitching: false
		});
		expect(
			await featureSettings({ WHEELHOUSE_ENABLE_FEATURES: 'remotes,hosted-second-mates' }, config)
		).toEqual({
			events: false,
			remotes: true,
			'hosted-second-mates': true,
			discussion: false,
			lanes: false,
			livereview: false,
			soundings: false,
			automaticProviderSwitching: false
		});

		await writeFile(path.join(config, 'features.json'), JSON.stringify({ events: true }));
		expect(await featureSettings({}, config)).toEqual({
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

	it('keeps an ordinary install off unless saved on or enabled at launch', async () => {
		const config = await configDir();
		expect(await featureSettings({}, config)).toEqual({
			events: false,
			remotes: false,
			'hosted-second-mates': false,
			discussion: false,
			lanes: false,
			livereview: false,
			soundings: false,
			automaticProviderSwitching: true
		});
		expect(
			await featureSettings({ WHEELHOUSE_ENABLE_FEATURES: 'remotes,hosted-second-mates' }, config)
		).toEqual({
			events: false,
			remotes: true,
			'hosted-second-mates': true,
			discussion: false,
			lanes: false,
			livereview: false,
			soundings: false,
			automaticProviderSwitching: true
		});
		await saveFeatureSettings(config, {
			events: false,
			remotes: true,
			'hosted-second-mates': false,
			discussion: false,
			lanes: false,
			livereview: false,
			soundings: false,
			automaticProviderSwitching: true
		});
		expect(await featureSettings({}, config)).toEqual({
			events: false,
			remotes: true,
			'hosted-second-mates': false,
			discussion: false,
			lanes: false,
			livereview: false,
			soundings: false,
			automaticProviderSwitching: true
		});
	});

	it('persists each choice and leaves other settings and feature data untouched', async () => {
		const config = await configDir();
		await saveFeatureSettings(config, {
			events: true,
			remotes: false,
			'hosted-second-mates': false,
			discussion: true,
			lanes: false,
			livereview: false,
			soundings: false,
			automaticProviderSwitching: true
		});
		await saveFeatureSettings(config, {
			events: false,
			remotes: true,
			'hosted-second-mates': true,
			discussion: false,
			lanes: false,
			livereview: false,
			soundings: false,
			automaticProviderSwitching: false
		});
		expect(await readSavedFeatures(config)).toEqual({
			events: false,
			remotes: true,
			'hosted-second-mates': true,
			discussion: false,
			lanes: false,
			livereview: false,
			soundings: false,
			automaticProviderSwitching: false
		});
		expect(JSON.parse(await readFile(path.join(config, 'features.json'), 'utf8'))).toEqual({
			events: false,
			remotes: true,
			'hosted-second-mates': true,
			discussion: false,
			lanes: false,
			livereview: false,
			soundings: false,
			automaticProviderSwitching: false
		});
	});

	it('reads the saved flags again only when the file or the setup answers change', async () => {
		const config = await configDir();
		const file = path.join(config, 'features.json');
		await writeFile(file, JSON.stringify({ events: true }));
		const first = await readSavedFeatures(config);
		expect(first.events).toBe(true);
		// What a caller does with its copy does not reach the next one.
		first.events = false;
		expect((await readSavedFeatures(config)).events).toBe(true);
		// A change by hand.
		await writeFile(file, JSON.stringify({ lanes: true }));
		expect(await readSavedFeatures(config)).toMatchObject({ events: false, lanes: true });
		// The defaults follow the setup answers too.
		expect((await readSavedFeatures(config)).remotes).toBe(false);
		await writeFile(
			answersFile(config),
			JSON.stringify({ schema: ANSWERS_SCHEMA, agent: 'claude', auth: 'subscription' })
		);
		expect((await readSavedFeatures(config)).remotes).toBe(true);
	});

	it('identifies feature-owned pages and APIs while leaving shared APIs available', () => {
		expect(featureForPath('/events')).toBe('events');
		expect(featureForPath('/api/wh-events')).toBe('events');
		expect(featureForPath('/remotes')).toBe('remotes');
		// Settings → Fleet is for everyone; the old Gateway and Cloud addresses lead to it.
		expect(featureForPath('/settings/fleet')).toBeNull();
		expect(featureForPath('/settings/cloud')).toBeNull();
		expect(featureForPath('/settings/gateway')).toBeNull();
		expect(featureForPath('/api/fleet/membership')).toBeNull();
		expect(featureForPath('/api/cloud/previews')).toBe('remotes');
		expect(featureForPath('/api/tasks/task%40tokyo/output')).toBe('remotes');
		expect(featureForPath('/tasks/task@tokyo/doc')).toBe('remotes');
		expect(featureForPath('/api/live')).toBe('discussion');
		expect(featureForPath('/settings/discussion')).toBe('discussion');
		expect(featureForPath('/api/events')).toBeNull();
		expect(featureForPath('/api/fleet')).toBeNull();
		expect(featureForPath('/second-mates')).toBeNull();
		expect(featureForPath('/second-mates/add')).toBe('hosted-second-mates');
		expect(featureForPath('/api/second-mates/tokyo/peek')).toBeNull();
		expect(featureForPath('/api/second-mate-setup')).toBe('hosted-second-mates');
		expect(featureForPath('/api/tasks/wh-task/livereview')).toBe('livereview');
		expect(featureForPath('/api/tasks/wh-task/preview')).toBeNull();
		expect(featureForPath('/tasks/wh-task/live')).toBe('livereview');
		expect(featureForPath('/tasks/wh-task/liveness')).toBeNull();
		expect(featureForPath('/live-review/wh-task')).toBe('livereview');
	});
});
