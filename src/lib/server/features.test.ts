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

describe('experimental features', () => {
	it('defaults both flags off and accepts only the two named launch enables', async () => {
		const config = await configDir();
		expect(await readSavedFeatures(config)).toEqual({ events: false, remotes: false });
		expect(await featureSettings({ WHEELHOUSE_ENABLE_FEATURES: 'events,remotes' }, config)).toEqual(
			{
				events: true,
				remotes: true
			}
		);
		expect(parseFeatureList('events, events,remotes')).toEqual(['events', 'remotes']);
		expect(() => parseFeatureList('events,other')).toThrow('Unknown feature "other"');
	});

	it('defaults remotes on for a cloud machine, while saved choices and launch enables still win', async () => {
		const config = await configDir();
		await writeFile(
			answersFile(config),
			JSON.stringify({ schema: ANSWERS_SCHEMA, agent: 'claude', auth: 'subscription' })
		);
		expect(await featureSettings({}, config)).toEqual({ events: false, remotes: true });

		await saveFeatureSettings(config, { events: false, remotes: false });
		expect(await featureSettings({}, config)).toEqual({ events: false, remotes: false });
		expect(await featureSettings({ WHEELHOUSE_ENABLE_FEATURES: 'remotes' }, config)).toEqual({
			events: false,
			remotes: true
		});

		await writeFile(path.join(config, 'features.json'), JSON.stringify({ events: true }));
		expect(await featureSettings({}, config)).toEqual({ events: true, remotes: true });
	});

	it('keeps an ordinary install off unless saved on or enabled at launch', async () => {
		const config = await configDir();
		expect(await featureSettings({}, config)).toEqual({ events: false, remotes: false });
		expect(await featureSettings({ WHEELHOUSE_ENABLE_FEATURES: 'remotes' }, config)).toEqual({
			events: false,
			remotes: true
		});
		await saveFeatureSettings(config, { events: false, remotes: true });
		expect(await featureSettings({}, config)).toEqual({ events: false, remotes: true });
	});

	it('persists each choice and leaves other settings and feature data untouched', async () => {
		const config = await configDir();
		await saveFeatureSettings(config, { events: true, remotes: false });
		await saveFeatureSettings(config, { events: false, remotes: true });
		expect(await readSavedFeatures(config)).toEqual({ events: false, remotes: true });
		expect(JSON.parse(await readFile(path.join(config, 'features.json'), 'utf8'))).toEqual({
			events: false,
			remotes: true
		});
	});

	it('identifies the feature-owned pages and APIs while leaving shared APIs available', () => {
		expect(featureForPath('/events')).toBe('events');
		expect(featureForPath('/api/wh-events')).toBe('events');
		expect(featureForPath('/remotes')).toBe('remotes');
		expect(featureForPath('/settings/cloud')).toBe('remotes');
		expect(featureForPath('/settings/gateway')).toBe('remotes');
		expect(featureForPath('/api/cloud/previews')).toBe('remotes');
		expect(featureForPath('/second-mates')).toBeNull();
		expect(featureForPath('/api/second-mates')).toBeNull();
		expect(featureForPath('/api/second-mates/tokyo/peek')).toBeNull();
		expect(featureForPath('/api/tasks/task%40tokyo/output')).toBeNull();
		expect(featureForPath('/tasks/task@tokyo/doc')).toBeNull();
		expect(featureForPath('/api/events')).toBeNull();
		expect(featureForPath('/api/fleet')).toBeNull();
	});
});
