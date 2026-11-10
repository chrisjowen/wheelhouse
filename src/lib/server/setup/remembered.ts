import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { RememberedInstall } from '../firstmate/install';

/**
 * The Firstmate the setup wizard chose, kept in Wheelhouse's config directory
 * (never in the Firstmate home), so `wheelhouse open` finds it again from any
 * folder:
 *
 *   { "firstmate": "/Users/me/firstmate", "home": "/Users/me/firstmate" }
 *
 * `--firstmate`, the checkout Wheelhouse runs in and $FM_HOME all still win
 * (see resolveInstall). Synchronous, and free of SvelteKit imports, so the CLI
 * bundles it.
 */

export const REMEMBERED_FILE = 'firstmate.json';

export const rememberedFile = (configDir: string) => path.join(configDir, REMEMBERED_FILE);

/** The remembered Firstmate, or null when there is none or the file is not one. */
export function readRemembered(configDir: string): RememberedInstall | null {
	let raw: unknown;
	try {
		raw = JSON.parse(readFileSync(rememberedFile(configDir), 'utf8'));
	} catch {
		return null;
	}
	if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
	const { firstmate, home } = raw as Record<string, unknown>;
	if (typeof firstmate !== 'string' || !path.isAbsolute(firstmate)) return null;
	if (home !== undefined && home !== null && (typeof home !== 'string' || !path.isAbsolute(home))) {
		return null;
	}
	return { firstmate, home: typeof home === 'string' ? home : null };
}

/** Remember `r`, through a temporary file so a reader never sees half of it. */
export function writeRemembered(configDir: string, r: RememberedInstall): void {
	mkdirSync(configDir, { recursive: true });
	const file = rememberedFile(configDir);
	const tmp = `${file}.${process.pid}.tmp`;
	const body: Record<string, string> = { firstmate: path.resolve(r.firstmate) };
	if (r.home) body.home = path.resolve(r.home);
	writeFileSync(tmp, `${JSON.stringify(body, null, '\t')}\n`, { mode: 0o644 });
	renameSync(tmp, file);
}
