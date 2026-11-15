import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	createFeatureService,
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
	it('does not construct a disabled background service and constructs an enabled one', async () => {
		const create = vi.fn(async () => ({ started: true }));
		expect(await createFeatureService(false, create)).toBeNull();
		expect(create).not.toHaveBeenCalled();
		expect(await createFeatureService(true, create)).toEqual({ started: true });
		expect(create).toHaveBeenCalledOnce();
	});

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
		expect(featureForPath('/api/cloud/previews')).toBe('remotes');
		expect(featureForPath('/api/second-mates/tokyo/peek')).toBe('remotes');
		expect(featureForPath('/api/tasks/task%40tokyo/output')).toBe('remotes');
		expect(featureForPath('/tasks/task@tokyo/doc')).toBe('remotes');
		expect(featureForPath('/api/events')).toBeNull();
		expect(featureForPath('/api/fleet')).toBeNull();
	});
});
