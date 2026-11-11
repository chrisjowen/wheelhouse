import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Updating Wheelhouse from the published npm package.
 * Compares the installed version (from the running package dir) against
 * `npm view @chrisjowen/wheelhouse version`, and updates with
 * `npm install -g @chrisjowen/wheelhouse@<version>`.
 *
 * Errors (e.g. EACCES permissions) are surfaced to the caller.
 */

export type NpmRun = (
	cmd: string,
	args: string[],
	cwd?: string
) => Promise<{ code: number; output: string }>;

export const runNpm: NpmRun = (cmd, args, cwd) =>
	new Promise((resolve) => {
		execFile(cmd, args, { cwd, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
			const output = `${String(stdout)}${String(stderr)}`;
			resolve({
				code: err ? (typeof err.code === 'number' ? err.code : 1) : 0,
				output: output.slice(-60_000)
			});
		});
	});

export interface NpmCheck {
	schema: 'wheelhouse-npm-update.v1';
	checkedAt: string;
	state: 'current' | 'available' | 'error';
	/** Why, when error or no update. */
	reason: string | null;
	/** The directory we inspected. */
	dir: string | null;
	current: { version: string | null };
	latest: { version: string } | null;
}

export type NpmUpgradeOutcome =
	| { ok: true; from: string | null; to: string }
	| { ok: false; error: string; output: string };

/** Read the version from the package.json at the given dir. */
export async function readInstalledVersion(dir: string): Promise<string | null> {
	try {
		const text = await readFile(path.join(dir, 'package.json'), 'utf8');
		const v = (JSON.parse(text) as { version?: unknown }).version;
		return typeof v === 'string' ? v : null;
	} catch {
		return null;
	}
}

/** Ask npm for the latest published version of the package. */
export async function npmViewLatest(run: NpmRun = runNpm): Promise<{ version: string } | { error: string }> {
	const r = await run('npm', ['view', '@chrisjowen/wheelhouse', 'version']);
	if (r.code !== 0) {
		return { error: r.output.trim() || 'npm view failed' };
	}
	const v = r.output.trim();
	if (!v) return { error: 'npm view returned no version' };
	return { version: v };
}

/** Check whether the installed package at dir is behind the published version. */
export async function checkNpm(
	dir: string | null,
	run: NpmRun = runNpm,
	now: () => Date = () => new Date()
): Promise<NpmCheck> {
	const out: NpmCheck = {
		schema: 'wheelhouse-npm-update.v1',
		checkedAt: now().toISOString(),
		state: 'error',
		reason: null,
		dir: dir ?? null,
		current: { version: null },
		latest: null
	};
	if (!dir) {
		out.reason = 'Wheelhouse does not know where it is installed.';
		return out;
	}
	out.current.version = await readInstalledVersion(dir);
	const view = await npmViewLatest(run);
	if ('error' in view) {
		out.reason = view.error;
		return out;
	}
	out.latest = { version: view.version };
	if (!out.current.version) {
		// Treat as available if we cannot read current (first run after global install etc.)
		out.state = 'available';
		return out;
	}
	// Compare semver-ish: simple string compare for exact, else treat as available if different
	if (out.current.version === view.version) {
		out.state = 'current';
	} else {
		out.state = 'available';
	}
	return out;
}

/** Run the global update to the given (or latest) version. Never mutates a clone. */
export async function upgradeNpm(
	dir: string | null,
	targetVersion: string | null,
	run: NpmRun = runNpm
): Promise<NpmUpgradeOutcome> {
	if (!dir) {
		return { ok: false, error: 'Wheelhouse does not know where it is installed.', output: '' };
	}
	const spec = targetVersion ? `@chrisjowen/wheelhouse@${targetVersion}` : '@chrisjowen/wheelhouse';
	const r = await run('npm', ['install', '-g', spec]);
	if (r.code !== 0) {
		return {
			ok: false,
			error: `npm install -g ${spec} failed (exit ${r.code})`,
			output: r.output
		};
	}
	return { ok: true, from: null, to: targetVersion ?? 'latest' };
}
