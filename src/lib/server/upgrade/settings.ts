import { existsSync, readFileSync, rmSync } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { UpdateSource } from '../../updates';

export type { UpdateSource };

export const UPDATE_SETTINGS_SCHEMA = 'wheelhouse-update-settings.v1';

export interface UpdateSettingsData {
	/** Chosen update source; null until chosen (then it follows how Wheelhouse is installed). */
	source: UpdateSource | null;
	/** Where switching to GitHub source clones Wheelhouse when it is not a clone; null for the default. */
	cloneDir: string | null;
}

const isObj = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

function isValidSource(s: unknown): s is UpdateSource {
	return s === 'published' || s === 'github';
}

/** The update settings directory inside a Wheelhouse config directory. */
export const updateDir = (configDir: string) => path.join(configDir, 'update');

export class UpdateSettings {
	constructor(readonly dir: string) {}

	get file(): string {
		return path.join(this.dir, 'settings.json');
	}

	/** The settings, with defaults for anything missing or unreadable. */
	async read(): Promise<{ settings: UpdateSettingsData; error: string | null }> {
		const settings: UpdateSettingsData = { source: null, cloneDir: null };
		let text: string;
		try {
			text = await readFile(this.file, 'utf8');
		} catch (e) {
			if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { settings, error: null };
			return { settings, error: `${this.file} could not be read: ${(e as Error).message}` };
		}
		let parsed: unknown;
		try {
			parsed = JSON.parse(text);
		} catch {
			return { settings, error: `${this.file} is not valid JSON.` };
		}
		if (!isObj(parsed) || parsed.schema !== UPDATE_SETTINGS_SCHEMA) {
			return { settings, error: `${this.file} is not a Wheelhouse update settings file.` };
		}
		const src = str(parsed.source);
		if (src && isValidSource(src)) settings.source = src;
		settings.cloneDir = str(parsed.cloneDir);
		return { settings, error: null };
	}

	async update(change: (s: UpdateSettingsData) => void): Promise<UpdateSettingsData> {
		const { settings } = await this.read();
		change(settings);
		if (!isValidSource(settings.source)) settings.source = null;
		await this.writeAtomic(
			this.file,
			JSON.stringify(
				{ schema: UPDATE_SETTINGS_SCHEMA, source: settings.source, cloneDir: settings.cloneDir },
				null,
				'\t'
			) + '\n'
		);
		return settings;
	}

	private async writeAtomic(file: string, text: string): Promise<void> {
		await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
		const tmp = `${file}.tmp-${process.pid}`;
		try {
			await writeFile(tmp, text, { mode: 0o600 });
			await rename(tmp, file);
		} catch (e) {
			await rm(tmp, { force: true }).catch(() => {});
			throw e;
		}
	}
}

/** Where switching to GitHub source clones Wheelhouse by default. */
export const defaultCloneDir = (configDir: string) => path.join(updateDir(configDir), 'wheelhouse');

/**
 * The install a restarted server should run from instead of the current one,
 * left by a source switch for `wheelhouse open`'s watcher.
 */
export const handoffFile = (configDir: string) => path.join(updateDir(configDir), 'next-install');

export async function writeHandoff(configDir: string, installDir: string): Promise<void> {
	await mkdir(updateDir(configDir), { recursive: true, mode: 0o700 });
	await writeFile(handoffFile(configDir), `${installDir}\n`, { mode: 0o600 });
}

/**
 * Read and remove the handoff: the install directory to run from, when it
 * holds a built Wheelhouse (dist/cli.js and build/handler.js), else null.
 */
export function takeHandoff(configDir: string): string | null {
	const file = handoffFile(configDir);
	let dir: string;
	try {
		dir = readFileSync(file, 'utf8').trim();
	} catch {
		return null;
	}
	rmSync(file, { force: true });
	if (!dir || !path.isAbsolute(dir)) return null;
	const built =
		existsSync(path.join(dir, 'dist', 'cli.js')) &&
		existsSync(path.join(dir, 'build', 'handler.js'));
	return built ? dir : null;
}
