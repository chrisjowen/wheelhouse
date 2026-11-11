import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

export type UpdateSource = 'published' | 'github';

export const UPDATE_SETTINGS_SCHEMA = 'wheelhouse-update-settings.v1';

export interface UpdateSettingsData {
	/** Chosen update source. Default 'published'. */
	source: UpdateSource;
}

const DEFAULT_SOURCE: UpdateSource = 'published';

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
		const settings: UpdateSettingsData = { source: DEFAULT_SOURCE };
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
		return { settings, error: null };
	}

	async update(change: (s: UpdateSettingsData) => void): Promise<UpdateSettingsData> {
		const { settings } = await this.read();
		change(settings);
		if (!isValidSource(settings.source)) settings.source = DEFAULT_SOURCE;
		await this.writeAtomic(
			this.file,
			JSON.stringify({ schema: UPDATE_SETTINGS_SCHEMA, source: settings.source }, null, '\t') + '\n'
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
