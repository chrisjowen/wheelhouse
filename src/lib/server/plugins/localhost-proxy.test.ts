import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { PROXY_PLUGIN } from '../../localproxy';
import type { Project } from '../../types';
import type { PluginConfig } from './config';
import { loadBundledPlugins, type LoadedPlugins } from './loader';
import { PluginRegistry } from './registry';

/**
 * The bundled Localhost proxy plugin: a switch and settings for Wheelhouse's
 * own proxy (server/localproxy), which reads them through builtinSettings.
 */

const BUNDLED = path.resolve('plugins');
const project = (id: string): Project => ({
	id,
	name: id,
	description: null,
	posture: null,
	registered: true,
	path: null,
	passage: null
});

let bundled: LoadedPlugins;
beforeAll(async () => {
	bundled = await loadBundledPlugins(BUNDLED);
});

const registry = (
	config: PluginConfig,
	installed: LoadedPlugins['installed'] = bundled.installed
) =>
	new PluginRegistry(
		[],
		{
			fleet: () => ({ projects: [project('alpha'), project('beta')], tasks: [] }),
			worktree: () => null,
			config: async () => ({ config, error: null })
		},
		{ plugins: installed }
	);

describe('the Localhost proxy plugin', () => {
	it('loads as built in, off by default, adding nothing to the pages', () => {
		expect(bundled.problems).toEqual([]);
		expect(
			registry({ plugins: {} })
				.status()
				.find((s) => s.id === PROXY_PLUGIN)
		).toMatchObject({
			name: 'Localhost proxy',
			state: 'loaded',
			source: 'builtin',
			enabledByDefault: false,
			slots: []
		});
	});

	it('declares its settings for Settings → Plugins', async () => {
		const page = await registry({ plugins: {} }).page(PROXY_PLUGIN);
		expect(page?.on).toBe(false);
		expect(page?.settings.map((s) => [s.key, s.type, s.default])).toEqual([
			['ports', 'list', []]
		]);
	});

	it('is off, so the proxy answers nothing, until the captain turns it on', async () => {
		expect(await registry({ plugins: {} }).builtinSettings(PROXY_PLUGIN)).toBeNull();
		expect(
			await registry({ plugins: { [PROXY_PLUGIN]: { enabled: false } } }).builtinSettings(
				PROXY_PLUGIN
			)
		).toBeNull();
		expect(
			await registry({
				plugins: { [PROXY_PLUGIN]: { enabled: true, settings: { ports: ['3000'] } } }
			}).builtinSettings(PROXY_PLUGIN)
		).toEqual({ ports: ['3000'] });
		// On for one project is on: the proxy is about the whole computer.
		expect(
			await registry({
				plugins: { [PROXY_PLUGIN]: { projects: { beta: true } } }
			}).builtinSettings(PROXY_PLUGIN)
		).toEqual({});
	});

	it('is never read from an installed plugin', async () => {
		const own = bundled.installed.find((p) => p.plugin.id === PROXY_PLUGIN)!;
		const reg = registry({ plugins: { [PROXY_PLUGIN]: { enabled: true } } }, [
			{ ...own, source: 'installed', repository: 'acme/proxy', commit: 'abc' }
		]);
		expect(await reg.builtinSettings(PROXY_PLUGIN)).toBeNull();
		expect(await reg.builtinSettings('missing')).toBeNull();
	});
});
