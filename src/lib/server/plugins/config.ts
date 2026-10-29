import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

/**
 * Which plugins are on, per project, and their settings. The captain owns this
 * file; the server only reads it, and `wheelhouse plugin` writes only the
 * `settings` of the plugin it installs or configures, from the captain's own
 * answers. It lives in Wheelhouse's config directory, never in a
 * Firstmate home or a project repo:
 *
 *   {
 *     "plugins": {
 *       "project-links": { "enabled": true, "projects": { "firstmate": false } }
 *     }
 *   }
 *
 * A project's own setting wins, then the plugin's `enabled`, then the
 * plugin's default. A missing file means every plugin keeps its default; an
 * unreadable or invalid one does the same and is reported in /api/plugins.
 */

export interface PluginSetting {
	enabled?: boolean;
	projects?: Record<string, boolean>;
	settings?: Record<string, unknown>;
}

export interface PluginConfig {
	plugins: Record<string, PluginSetting>;
}

export const EMPTY_CONFIG: PluginConfig = { plugins: {} };

export function defaultConfigDir(env: NodeJS.ProcessEnv): string {
	if (env.WHEELHOUSE_CONFIG_DIR) return path.resolve(env.WHEELHOUSE_CONFIG_DIR);
	if (env.XDG_CONFIG_HOME) return path.join(env.XDG_CONFIG_HOME, 'wheelhouse');
	return path.join(homedir(), '.config', 'wheelhouse');
}

export const PLUGINS_FILE = 'plugins.json';

const isRecord = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);

export function parsePluginConfig(
	text: string
): { ok: true; config: PluginConfig } | { ok: false; error: string } {
	let raw: unknown;
	try {
		raw = JSON.parse(text);
	} catch (e) {
		return { ok: false, error: `not valid JSON: ${(e as Error).message}` };
	}
	if (!isRecord(raw)) return { ok: false, error: 'expected a JSON object' };
	for (const k of Object.keys(raw)) {
		if (k !== 'plugins') return { ok: false, error: `unknown field "${k}"` };
	}
	const plugins: Record<string, PluginSetting> = {};
	if (raw.plugins !== undefined) {
		if (!isRecord(raw.plugins)) return { ok: false, error: '"plugins" must be an object' };
		for (const [id, s] of Object.entries(raw.plugins)) {
			if (!isRecord(s)) return { ok: false, error: `plugins.${id} must be an object` };
			const setting: PluginSetting = {};
			for (const [k, v] of Object.entries(s)) {
				if (k === 'enabled') {
					if (typeof v !== 'boolean') {
						return { ok: false, error: `plugins.${id}.enabled must be true or false` };
					}
					setting.enabled = v;
				} else if (k === 'projects') {
					if (!isRecord(v)) return { ok: false, error: `plugins.${id}.projects must be an object` };
					for (const [p, on] of Object.entries(v)) {
						if (typeof on !== 'boolean') {
							return { ok: false, error: `plugins.${id}.projects.${p} must be true or false` };
						}
					}
					setting.projects = v as Record<string, boolean>;
				} else if (k === 'settings') {
					if (!isRecord(v)) return { ok: false, error: `plugins.${id}.settings must be an object` };
					setting.settings = v;
				} else {
					return { ok: false, error: `unknown field "plugins.${id}.${k}"` };
				}
			}
			plugins[id] = setting;
		}
	}
	return { ok: true, config: { plugins } };
}

/** `defaultOn` is the plugin's default for this project, when the host has worked it out. */
export function isEnabled(
	config: PluginConfig,
	plugin: { id: string; enabledByDefault?: boolean },
	projectId: string,
	defaultOn: boolean = plugin.enabledByDefault ?? false
): boolean {
	const s = config.plugins[plugin.id];
	return s?.projects?.[projectId] ?? s?.enabled ?? defaultOn;
}

/** The plugins file, re-read when it changes. */
export class PluginConfigFile {
	private mtimeMs: number | null = null;
	private cached: { config: PluginConfig; error: string | null } = {
		config: EMPTY_CONFIG,
		error: null
	};
	/** A read in progress, shared by calls that arrive meanwhile, so none sees the defaults early. */
	private reading: {
		mtimeMs: number;
		done: Promise<{ config: PluginConfig; error: string | null }>;
	} | null = null;

	constructor(readonly file: string) {}

	async current(): Promise<{ config: PluginConfig; error: string | null }> {
		let mtimeMs: number;
		try {
			mtimeMs = (await stat(this.file)).mtimeMs;
		} catch (e) {
			this.mtimeMs = null;
			const code = (e as NodeJS.ErrnoException).code;
			this.cached = {
				config: EMPTY_CONFIG,
				error: code === 'ENOENT' ? null : `could not read ${this.file}: ${(e as Error).message}`
			};
			return this.cached;
		}
		if (mtimeMs === this.mtimeMs) return this.cached;
		if (this.reading?.mtimeMs === mtimeMs) return this.reading.done;
		const done = this.read().then((r) => {
			if (this.reading?.done === done) {
				this.cached = r;
				this.mtimeMs = mtimeMs;
				this.reading = null;
			}
			return r;
		});
		this.reading = { mtimeMs, done };
		return done;
	}

	private async read(): Promise<{ config: PluginConfig; error: string | null }> {
		try {
			const parsed = parsePluginConfig(await readFile(this.file, 'utf8'));
			return parsed.ok
				? { config: parsed.config, error: null }
				: { config: EMPTY_CONFIG, error: `${this.file}: ${parsed.error}` };
		} catch (e) {
			return {
				config: EMPTY_CONFIG,
				error: `could not read ${this.file}: ${(e as Error).message}`
			};
		}
	}
}

type Settings = Record<string, unknown>;

/** The plugins file as it stands, checked, or null when there is none yet. */
async function readRaw(
	file: string
): Promise<{ ok: true; raw: Record<string, unknown> | null } | { ok: false; error: string }> {
	let text: string;
	try {
		text = await readFile(file, 'utf8');
	} catch (e) {
		if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { ok: true, raw: null };
		return { ok: false, error: `could not read ${file}: ${(e as Error).message}` };
	}
	const parsed = parsePluginConfig(text);
	if (!parsed.ok) return { ok: false, error: `${file} is not valid: ${parsed.error}` };
	return { ok: true, raw: JSON.parse(text) as Record<string, unknown> };
}

/** The settings the plugins file in `dir` holds for `id`: none when it has none. */
export async function readPluginSettings(
	dir: string,
	id: string
): Promise<{ ok: true; settings: Settings } | { ok: false; error: string }> {
	const r = await readRaw(path.join(dir, PLUGINS_FILE));
	if (!r.ok) return r;
	const plugins = (r.raw?.plugins ?? {}) as Record<string, PluginSetting>;
	return { ok: true, settings: { ...(plugins[id]?.settings ?? {}) } };
}

/**
 * Set `id`'s settings in the plugins file in `dir`, keeping everything else in
 * it, through a temporary file. An unreadable or invalid file is left alone.
 */
export async function writePluginSettings(
	dir: string,
	id: string,
	settings: Settings
): Promise<{ ok: true } | { ok: false; error: string }> {
	const file = path.join(dir, PLUGINS_FILE);
	const r = await readRaw(file);
	if (!r.ok) return r;
	const raw = r.raw ?? {};
	const plugins = isRecord(raw.plugins) ? raw.plugins : {};
	plugins[id] = { ...(isRecord(plugins[id]) ? plugins[id] : {}), settings };
	raw.plugins = plugins;
	await mkdir(dir, { recursive: true });
	const tmp = `${file}.${process.pid}.tmp`;
	await writeFile(tmp, `${JSON.stringify(raw, null, '\t')}\n`);
	await rename(tmp, file);
	return { ok: true };
}
