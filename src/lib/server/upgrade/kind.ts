import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';

/**
 * How Wheelhouse itself is installed: from a published npm package (global or local),
 * or from a git clone (the checkout may be linked into the global npm tree via
 * `npm link`, or `wheelhouse` may be run directly from the clone's dist).
 * Detection walks the real path of the running package for a .git directory.
 * No hard-coded paths; derived only from where this package's code is loaded.
 */
export type InstallKind = 'npm' | 'clone' | 'unknown';

export interface InstallInfo {
	kind: InstallKind;
	dir: string | null;
	/** The resolved real directory the running package lives in. */
	realDir: string | null;
	/** Current version from its package.json, if readable. */
	version: string | null;
}

/** Read version from a package.json if present. */
async function readVersion(dir: string): Promise<string | null> {
	try {
		const pkg = JSON.parse(await readFile(path.join(dir, 'package.json'), 'utf8')) as {
			version?: string;
		};
		return typeof pkg.version === 'string' ? pkg.version : null;
	} catch {
		return null;
	}
}

/** True if walking up from `start` finds a .git entry (dir or gitdir file). */
async function hasGitAncestor(start: string): Promise<boolean> {
	try {
		let d = await realpath(start);
		for (let i = 0; i < 30; i++) {
			try {
				const st = await stat(path.join(d, '.git'));
				if (st.isDirectory() || st.isFile()) return true;
			} catch {
				// no .git here
			}
			const parent = path.dirname(d);
			if (parent === d) break;
			d = parent;
		}
	} catch {
		// ignore
	}
	return false;
}

/**
 * Detect whether the install at `dir` (e.g. from WHEELHOUSE_INSTALL_DIR or cli installDir)
 * is a git clone on disk (possibly linked) or a published npm package.
 * The decision is made only from the location of the running code.
 */
export async function detectInstallKind(dir: string | null | undefined): Promise<InstallInfo> {
	if (!dir) {
		return { kind: 'unknown', dir: null, realDir: null, version: null };
	}
	const resolvedDir = path.resolve(dir);
	let real: string;
	try {
		real = await realpath(resolvedDir);
	} catch {
		real = resolvedDir;
	}
	const isClone = await hasGitAncestor(real);
	const kind: InstallKind = isClone ? 'clone' : 'npm';
	const version = await readVersion(real).catch(() => null);
	return {
		kind,
		dir: resolvedDir,
		realDir: real,
		version
	};
}
