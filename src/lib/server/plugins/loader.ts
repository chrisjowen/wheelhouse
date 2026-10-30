import { readdir, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { PluginStatus } from '../../plugins/types';
import { readInstalled, type InstalledRecord } from './installed';
import {
	fromExport,
	manifestPath,
	parseManifest,
	type PluginManifest,
	type SettingSpec
} from './manifest';
import type { WheelhousePlugin } from './types';

/**
 * Loads installed plugins at startup, without rebuilding Wheelhouse: for each
 * one `installed.json` has on, it reads and checks the manifest, then imports
 * the server entry it names. A plugin that cannot be read, is invalid, throws
 * while importing or takes too long becomes a `failed` entry with the reason,
 * and the rest load as usual. A loaded plugin then goes through the same
 * registry checks and read-only context as a compiled-in one. Plugins bundled
 * with Wheelhouse, in the same format, load the same way and show as built in.
 */

const ID = /^[a-z][a-z0-9-]{0,39}$/;
export const IMPORT_TIMEOUT_MS = 5_000;

export interface InstalledPlugin {
	plugin: WheelhousePlugin;
	/** Bundled with Wheelhouse (`builtin`, with no repository or commit), or installed. */
	source: PluginStatus['source'];
	repository: string | null;
	commit: string | null;
	/** Where its UI bundle is: the directory its files are served from, and the entry within it. */
	ui: { dir: string; entry: string } | null;
	/** What its manifest says it is for, and the settings it declares. */
	description?: string | null;
	settings?: SettingSpec[];
}

export interface LoadedPlugins {
	installed: InstalledPlugin[];
	/** Installed plugins that are off or could not be loaded, ready for the plugins view. */
	problems: PluginStatus[];
	/** Why installed.json itself could not be read, if it could not. */
	error: string | null;
}

export interface LoaderOptions {
	/** How a server entry is imported; tests replace it. */
	importModule?: (url: string) => Promise<unknown>;
	timeoutMs?: number;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * `$WHEELHOUSE_BUNDLED_PLUGINS_DIR` (the CLI sets it to the package's
 * `plugins`), else `plugins` in the working directory, as in development.
 */
export function bundledPluginsDir(env: NodeJS.ProcessEnv): string {
	return path.resolve(env.WHEELHOUSE_BUNDLED_PLUGINS_DIR || 'plugins');
}

/** An existing file under `root`, symlinks resolved, or why it is not one. */
async function within(root: string, rel: string): Promise<string> {
	const base = await realpath(root);
	let file: string;
	try {
		file = await realpath(path.resolve(base, rel));
	} catch {
		throw new Error(`${rel} is missing.`);
	}
	if (!file.startsWith(base + path.sep)) throw new Error(`${rel} leads outside the plugin.`);
	return file;
}

/**
 * A file of a UI bundle: `rel` (a URL path) under the bundle's directory,
 * symlinks resolved; null when it is missing or leaves that directory.
 */
export async function uiFile(dir: string, rel: string): Promise<string | null> {
	if (
		!rel ||
		rel.startsWith('/') ||
		rel.split('/').some((s) => s === '..' || s === '' || s === '.')
	) {
		return null;
	}
	try {
		const base = await realpath(dir);
		const file = await realpath(path.join(base, rel));
		return file.startsWith(base + path.sep) ? file : null;
	} catch {
		return null;
	}
}

function status(
	id: string,
	r: InstalledRecord | null,
	m: PluginManifest | null,
	state: 'failed' | 'disabled',
	reason: string | null
): PluginStatus {
	const name = m?.displayName ?? id;
	return {
		id,
		name,
		version: m?.version ?? r?.version ?? '0.0.0',
		apiVersion: m?.wheelhouse.apiVersion ?? 0,
		state,
		reason: reason ? `Wheelhouse did not load ${name}: ${reason}` : null,
		source: r ? 'installed' : 'builtin',
		repository: r?.repository ?? null,
		commit: r?.commit ?? null,
		slots: m ? [...new Set(m.wheelhouse.contributions.map((c) => c.slot))] : [],
		enabledByDefault: m?.wheelhouse.enabledByDefault ?? false,
		enabledWhenFile: m?.wheelhouse.enabledWhenFile ?? null,
		enabledWhenHomeFile: m?.wheelhouse.enabledWhenHomeFile ?? null,
		description: m?.description ?? null,
		settings: m?.wheelhouse.settings ?? []
	};
}

async function importWithin(
	url: string,
	importModule: (url: string) => Promise<unknown>,
	timeoutMs: number
): Promise<unknown> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			Promise.resolve().then(() => importModule(url)),
			new Promise((_, reject) => {
				timer = setTimeout(
					() => reject(new Error(`its server entry did not load within ${timeoutMs} ms.`)),
					timeoutMs
				);
			})
		]);
	} finally {
		clearTimeout(timer);
	}
}

/** One installed plugin (or, with no record, a bundled one), ready for the registry, or why it is not. */
export async function loadOne(
	dir: string,
	id: string,
	r: InstalledRecord | null,
	o: LoaderOptions = {}
): Promise<{ ok: true; plugin: InstalledPlugin } | { ok: false; status: PluginStatus }> {
	let m: PluginManifest | null = null;
	const fail = (reason: string) => ({
		ok: false as const,
		status: status(id, r, m, 'failed', reason)
	});
	if (!ID.test(id)) return fail(`"${id}" is not a plugin id.`);
	const root = path.join(dir, id);
	let text: string | null = null;
	let readError = '';
	try {
		text = await readFile(manifestPath(root), 'utf8');
	} catch (e) {
		readError = message(e);
	}
	const parsed = text === null ? null : parseManifest(text);
	if (parsed?.ok) m = parsed.manifest;
	// A plugin that is off is never imported; it shows what its manifest says, if anything.
	if (r && !r.enabled) return { ok: false, status: status(id, r, m, 'disabled', null) };
	if (!parsed) return fail(`its manifest could not be read: ${readError}`);
	if (!parsed.ok) return fail(`its manifest is not valid: ${parsed.error}.`);
	m = parsed.manifest;
	if (m.name !== id)
		return fail(`its manifest names it "${m.name}", but it is installed as "${id}".`);
	let server: string;
	let ui: InstalledPlugin['ui'] = null;
	try {
		server = await within(root, m.wheelhouse.server);
		if (m.wheelhouse.ui) {
			const entry = await within(root, m.wheelhouse.ui);
			ui = { dir: path.dirname(entry), entry: path.basename(entry) };
		}
	} catch (e) {
		return fail(message(e));
	}
	let exported: unknown;
	try {
		// The commit in the URL keeps an updated plugin from reusing the old module.
		const url = `${pathToFileURL(server).href}${r ? `?commit=${encodeURIComponent(r.commit)}` : ''}`;
		exported = await importWithin(
			url,
			o.importModule ?? ((u) => import(/* @vite-ignore */ u)),
			o.timeoutMs ?? IMPORT_TIMEOUT_MS
		);
	} catch (e) {
		return fail(`its server entry failed to load: ${message(e)}`);
	}
	let made: ReturnType<typeof fromExport>;
	try {
		made = fromExport(m, exported, { panels: !r });
	} catch (e) {
		return fail(`its server entry could not be read: ${message(e)}`);
	}
	if (!made.ok) return fail(made.error);
	return {
		ok: true,
		plugin: {
			plugin: made.plugin,
			source: r ? 'installed' : 'builtin',
			repository: r?.repository ?? null,
			commit: r?.commit ?? null,
			ui,
			description: m.description,
			settings: m.wheelhouse.settings
		}
	};
}

function collect(results: Awaited<ReturnType<typeof loadOne>>[]): Omit<LoadedPlugins, 'error'> {
	const installed: InstalledPlugin[] = [];
	const problems: PluginStatus[] = [];
	for (const res of results) {
		if (res.ok) installed.push(res.plugin);
		else problems.push(res.status);
	}
	return { installed, problems };
}

/** Every plugin bundled with Wheelhouse in `dir`, one per directory, in id order. */
export async function loadBundledPlugins(
	dir: string,
	o: LoaderOptions = {}
): Promise<LoadedPlugins> {
	let ids: string[];
	try {
		ids = (await readdir(dir, { withFileTypes: true }))
			.filter((d) => d.isDirectory())
			.map((d) => d.name)
			.sort();
	} catch (e) {
		return { installed: [], problems: [], error: `could not read ${dir}: ${message(e)}` };
	}
	const results = await Promise.all(ids.map((id) => loadOne(dir, id, null, o)));
	return { ...collect(results), error: null };
}

/** Every plugin installed in `dir`, in id order. */
export async function loadInstalledPlugins(
	dir: string,
	o: LoaderOptions = {}
): Promise<LoadedPlugins> {
	const read = await readInstalled(dir);
	if (!read.ok) return { installed: [], problems: [], error: read.error };
	const ids = Object.keys(read.installed.plugins).sort();
	const results = await Promise.all(
		ids.map((id) => loadOne(dir, id, read.installed.plugins[id], o))
	);
	return { ...collect(results), error: null };
}
