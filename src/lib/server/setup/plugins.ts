import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { SetupPlugin } from '../../setup';
import {
	changePlugin,
	EMPTY_CONFIG,
	parsePluginConfig,
	PLUGINS_FILE,
	type PluginConfig
} from '../plugins/config';
import { readInstalled } from '../plugins/installed';
import { manifestPath, parseManifest } from '../plugins/manifest';
import { SETUP_SUGGESTIONS } from '../plugins/suggested';

/**
 * The plugins step: every plugin bundled with Wheelhouse, from its own
 * manifest, with whether it is on for every project now (the plugins file,
 * else the plugin's default); then the suggestions to install from GitHub,
 * with whether each is installed. A switch writes the plugin's `enabled` in
 * the plugins file, exactly as Settings → Plugins does.
 */

export interface PluginsOptions {
	bundledDir: string;
	configDir: string;
	pluginsDir: string;
	/** The Firstmate home, for a plugin on only while the home has a file. */
	homeDir: string | null;
}

export async function setupPlugins(opts: PluginsOptions): Promise<SetupPlugin[]> {
	let config: PluginConfig = EMPTY_CONFIG;
	try {
		const parsed = parsePluginConfig(
			await readFile(path.join(opts.configDir, PLUGINS_FILE), 'utf8')
		);
		if (parsed.ok) config = parsed.config;
	} catch {
		// no plugins file yet: every plugin keeps its default
	}
	const out: SetupPlugin[] = [];
	let names: string[] = [];
	try {
		names = (await readdir(opts.bundledDir)).sort();
	} catch {
		// no bundled plugins here
	}
	for (const name of names) {
		let text: string;
		try {
			text = await readFile(manifestPath(path.join(opts.bundledDir, name)), 'utf8');
		} catch {
			continue;
		}
		const m = parseManifest(text);
		if (!m.ok) continue;
		const w = m.manifest.wheelhouse;
		const byDefault =
			w.enabledByDefault === true ||
			Boolean(
				w.enabledWhenHomeFile &&
				opts.homeDir &&
				existsSync(path.join(opts.homeDir, w.enabledWhenHomeFile))
			);
		out.push({
			id: m.manifest.name,
			name: m.manifest.displayName,
			description: m.manifest.description,
			source: 'bundled',
			on: config.plugins[m.manifest.name]?.enabled ?? byDefault,
			repository: null
		});
	}
	const installed = await readInstalled(opts.pluginsDir);
	const have = installed.ok ? installed.installed.plugins : {};
	for (const s of SETUP_SUGGESTIONS) {
		if (out.some((p) => p.id === s.id)) continue;
		out.push({
			id: s.id,
			name: s.name,
			description: s.why,
			source: 'installable',
			on: Boolean(have[s.id]),
			repository: s.repository
		});
	}
	return out;
}

/** Turn a bundled plugin on or off for every project. */
export async function switchPlugin(
	opts: PluginsOptions,
	id: string,
	on: boolean
): Promise<{ ok: true } | { ok: false; error: string }> {
	const known = (await setupPlugins(opts)).find((p) => p.id === id && p.source === 'bundled');
	if (!known) return { ok: false, error: `${id} is not a plugin bundled with Wheelhouse.` };
	return changePlugin(opts.configDir, id, { enabled: on });
}
