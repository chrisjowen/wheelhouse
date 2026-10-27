import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

/**
 * Installed plugins: each in `<plugins dir>/<id>/`, a copy of its repository
 * at one exact commit, and `installed.json` beside them recording where each
 * came from and whether it is on. Only `wheelhouse plugin` writes them; the
 * server reads them once at startup. Nothing updates a plugin by itself.
 *
 *   {
 *     "schema": "wheelhouse-installed-plugins.v1",
 *     "plugins": {
 *       "project-links": {
 *         "repository": "chrisjowen/wheelhouse-project-links",
 *         "ref": "v0.1.0",
 *         "commit": "4f1c…",
 *         "version": "0.1.0",
 *         "installedAt": "2026-10-27T10:00:00.000Z",
 *         "enabled": true
 *       }
 *     }
 *   }
 */

export const INSTALLED_FILE = 'installed.json';
const SCHEMA = 'wheelhouse-installed-plugins.v1';

export interface InstalledRecord {
	/** `org/repo` on GitHub. */
	repository: string;
	/** The tag, branch or commit asked for, or null for the default branch. */
	ref: string | null;
	/** The exact commit installed. */
	commit: string;
	version: string;
	installedAt: string;
	enabled: boolean;
}

export interface InstalledPlugins {
	schema: typeof SCHEMA;
	plugins: Record<string, InstalledRecord>;
}

export const EMPTY_INSTALLED = (): InstalledPlugins => ({ schema: SCHEMA, plugins: {} });

/** `$WHEELHOUSE_PLUGINS_DIR`, else `~/.wheelhouse/plugins`. */
export function defaultPluginsDir(env: NodeJS.ProcessEnv): string {
	if (env.WHEELHOUSE_PLUGINS_DIR) return path.resolve(env.WHEELHOUSE_PLUGINS_DIR);
	return path.join(homedir(), '.wheelhouse', 'plugins');
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);

function record(v: unknown): InstalledRecord | null {
	if (!isRecord(v)) return null;
	const { repository, ref, commit, version, installedAt, enabled } = v;
	if (
		typeof repository !== 'string' ||
		(ref !== null && typeof ref !== 'string') ||
		typeof commit !== 'string' ||
		typeof version !== 'string' ||
		typeof installedAt !== 'string' ||
		typeof enabled !== 'boolean'
	) {
		return null;
	}
	return { repository, ref, commit, version, installedAt, enabled };
}

/** The record of installed plugins; an empty one when there is no file yet. */
export async function readInstalled(
	dir: string
): Promise<{ ok: true; installed: InstalledPlugins } | { ok: false; error: string }> {
	const file = path.join(dir, INSTALLED_FILE);
	let text: string;
	try {
		text = await readFile(file, 'utf8');
	} catch (e) {
		if ((e as NodeJS.ErrnoException).code === 'ENOENT')
			return { ok: true, installed: EMPTY_INSTALLED() };
		return { ok: false, error: `could not read ${file}: ${(e as Error).message}` };
	}
	let raw: unknown;
	try {
		raw = JSON.parse(text);
	} catch (e) {
		return { ok: false, error: `${file} is not valid JSON: ${(e as Error).message}` };
	}
	if (!isRecord(raw) || raw.schema !== SCHEMA || !isRecord(raw.plugins)) {
		return { ok: false, error: `${file} is not a ${SCHEMA} record` };
	}
	const installed = EMPTY_INSTALLED();
	for (const [id, v] of Object.entries(raw.plugins)) {
		const r = record(v);
		if (!r) return { ok: false, error: `${file}: the entry for "${id}" is not a valid record` };
		installed.plugins[id] = r;
	}
	return { ok: true, installed };
}

/** Write the record whole, through a temporary file, so a reader never sees half of it. */
export async function writeInstalled(dir: string, installed: InstalledPlugins): Promise<void> {
	await mkdir(dir, { recursive: true });
	const file = path.join(dir, INSTALLED_FILE);
	const tmp = `${file}.${process.pid}.tmp`;
	await writeFile(tmp, `${JSON.stringify(installed, null, '\t')}\n`);
	await rename(tmp, file);
}
