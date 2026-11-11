import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { UpdateCheck } from '../../updates';

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

export type NpmUpgradeOutcome =
	{ ok: true; from: string | null; to: string } | { ok: false; error: string; output: string };

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
export async function npmViewLatest(
	run: NpmRun = runNpm
): Promise<{ version: string } | { error: string }> {
	const r = await run('npm', ['view', '@chrisjowen/wheelhouse', 'version']);
	if (r.code !== 0) {
		return { error: r.output.trim() || 'npm view failed' };
	}
	const v = r.output.trim();
	if (!v) return { error: 'npm view returned no version' };
	return { version: v };
}

/** Order two versions as semver does (pre-releases before their release); negative when a < b. */
export function compareVersions(a: string, b: string): number {
	const parse = (v: string) => {
		const [core, pre] = v.trim().replace(/^v/, '').split('+')[0].split(/-(.*)/s);
		return { nums: core.split('.').map((n) => Number.parseInt(n, 10) || 0), pre: pre ?? null };
	};
	const x = parse(a);
	const y = parse(b);
	for (let i = 0; i < 3; i++) {
		const d = (x.nums[i] ?? 0) - (y.nums[i] ?? 0);
		if (d !== 0) return d;
	}
	if (x.pre === y.pre) return 0;
	if (x.pre === null) return 1;
	if (y.pre === null) return -1;
	const xs = x.pre.split('.');
	const ys = y.pre.split('.');
	for (let i = 0; i < Math.max(xs.length, ys.length); i++) {
		if (xs[i] === undefined) return -1;
		if (ys[i] === undefined) return 1;
		const xn = /^\d+$/.test(xs[i]) ? Number(xs[i]) : null;
		const yn = /^\d+$/.test(ys[i]) ? Number(ys[i]) : null;
		if (xn !== null && yn !== null) {
			if (xn !== yn) return xn - yn;
		} else if (xn !== null) return -1;
		else if (yn !== null) return 1;
		else if (xs[i] !== ys[i]) return xs[i] < ys[i] ? -1 : 1;
	}
	return 0;
}

/** Check whether the installed package at dir is behind the published version. */
export async function checkNpm(
	dir: string | null,
	run: NpmRun = runNpm,
	now: () => Date = () => new Date()
): Promise<UpdateCheck> {
	const out: UpdateCheck = {
		schema: 'wheelhouse-update.v1',
		checkedAt: now().toISOString(),
		state: 'error',
		reason: null,
		dir: dir ?? '',
		repository: null,
		branch: null,
		current: { commit: null, version: null },
		latest: null,
		commits: [],
		behind: 0,
		changes: []
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
	out.latest = { commit: '', version: view.version };
	out.state =
		!out.current.version || compareVersions(out.current.version, view.version) < 0
			? 'available'
			: 'current';
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

/** Where `npm install -g` puts the published package (from `npm root -g`). */
export async function npmGlobalDir(run: NpmRun = runNpm): Promise<string | null> {
	const r = await run('npm', ['root', '-g']);
	const root = r.output.trim().split('\n').pop()?.trim();
	return r.code === 0 && root ? path.join(root, '@chrisjowen', 'wheelhouse') : null;
}
