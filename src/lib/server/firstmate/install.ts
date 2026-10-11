import { access, constants, open, stat } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { runBounded } from './exec';

/**
 * Locating a Firstmate installation and checking that its integration scripts
 * are the versions this Wheelhouse understands. Shared by the CLI (to fail fast
 * with a clear message) and the server (to report compatibility in
 * /api/health). This module has no SvelteKit imports so the CLI can bundle it.
 */

export interface FirstmateInstall {
	/** The Firstmate code directory (contains bin/). */
	firstmateDir: string;
	/** The operational home (contains state/ and data/). */
	homeDir: string;
}

export interface SupportedScript {
	name: string;
	/** Text the script must contain for its contract to be the one we parse. */
	markers: string[];
	purpose: string;
}

/** The SUPPORTED_SCRIPTS purpose that gates sending messages to Firstmate. */
export const MESSAGING_PURPOSE = 'messages to Firstmate';

/** The integration scripts this release wraps, one entry per contract, with its markers. */
export const SUPPORTED_SCRIPTS: readonly SupportedScript[] = [
	{
		name: 'fm-fleet-snapshot.sh',
		markers: ['fm-fleet-snapshot.v1', '`--json`'],
		purpose: 'fleet and current task state'
	},
	{
		name: 'fm-inbox.sh',
		markers: ['fm-inbox.sh ready', 'fm-primary-ready.v1'],
		purpose: 'supervisor readiness'
	},
	{
		name: 'fm-inbox.sh',
		markers: [
			'fm-inbox.sh note [--request-id <id>] [--json]',
			'fm-inbox.sh receipts [--after <cursor>]',
			'fm-inbox-note.v1',
			'fm-inbox-receipts.v1'
		],
		purpose: MESSAGING_PURPOSE
	},
	{
		name: 'fm-peek.sh',
		markers: ['Usage: fm-peek.sh <target> [lines'],
		purpose: 'worker terminal output'
	}
];

export const scriptPath = (firstmateDir: string, name: string) =>
	path.join(firstmateDir, 'bin', name);

const isDir = (p: string) => {
	try {
		return statSync(p).isDirectory();
	} catch {
		return false;
	}
};

/** True when `dir` looks like a Firstmate code checkout. */
export function looksLikeFirstmate(dir: string): boolean {
	return existsSync(scriptPath(dir, 'fm-fleet-snapshot.sh'));
}

/** Walk up from `start` to the nearest Firstmate checkout, if any. */
export function findFirstmateDir(start: string): string | null {
	let dir = path.resolve(start);
	for (;;) {
		if (looksLikeFirstmate(dir)) return dir;
		const parent = path.dirname(dir);
		if (parent === dir) return null;
		dir = parent;
	}
}

export interface ResolveInput {
	firstmate?: string;
	home?: string;
	cwd: string;
	env: NodeJS.ProcessEnv;
}

export type ResolveResult =
	{ ok: true; install: FirstmateInstall; notes: string[] } | { ok: false; error: string };

const expandHome = (p: string, env: NodeJS.ProcessEnv) =>
	p === '~' || p.startsWith('~/') ? path.join(env.HOME ?? '', p.slice(1)) : p;

/**
 * Resolve the Firstmate code directory and operational home.
 *
 * Code directory: --firstmate, else the nearest Firstmate checkout above cwd.
 * Home: --home, else $FM_HOME, else the code directory (Firstmate's own default).
 */
export function resolveInstall(input: ResolveInput): ResolveResult {
	const notes: string[] = [];
	let firstmateDir: string;
	if (input.firstmate) {
		firstmateDir = path.resolve(input.cwd, expandHome(input.firstmate, input.env));
		if (!isDir(firstmateDir)) {
			return { ok: false, error: `Firstmate directory not found: ${firstmateDir}` };
		}
		if (!looksLikeFirstmate(firstmateDir)) {
			return {
				ok: false,
				error: `${firstmateDir} is not a Firstmate checkout (bin/fm-fleet-snapshot.sh is missing).`
			};
		}
	} else {
		const found = findFirstmateDir(input.cwd);
		if (!found) {
			return {
				ok: false,
				error:
					'Could not find a Firstmate checkout. Run wheelhouse inside one, or pass --firstmate <dir>.'
			};
		}
		firstmateDir = found;
		notes.push(`Found Firstmate at ${firstmateDir}`);
	}

	let homeDir: string;
	if (input.home) {
		homeDir = path.resolve(input.cwd, expandHome(input.home, input.env));
	} else if (input.env.FM_HOME) {
		homeDir = path.resolve(input.cwd, expandHome(input.env.FM_HOME, input.env));
		notes.push(`Using the operational home from FM_HOME: ${homeDir}`);
	} else {
		homeDir = firstmateDir;
	}
	if (!isDir(homeDir)) {
		return { ok: false, error: `Firstmate home not found: ${homeDir}` };
	}
	if (!isDir(path.join(homeDir, 'state'))) {
		return {
			ok: false,
			error: `${homeDir} is not a Firstmate operational home (it has no state/ directory). Pass --home <dir>.`
		};
	}
	return { ok: true, install: { firstmateDir, homeDir }, notes };
}

export interface ScriptCheck {
	name: string;
	path: string;
	purpose: string;
	ok: boolean;
	problem: string | null;
}

export interface Compatibility {
	compatible: boolean;
	checkedAt: string;
	firstmateVersion: string | null;
	scripts: ScriptCheck[];
	problems: string[];
}

const HEADER_BYTES = 256 * 1024;

async function readHead(file: string): Promise<string> {
	const fh = await open(file, 'r');
	try {
		const buf = Buffer.alloc(HEADER_BYTES);
		const { bytesRead } = await fh.read(buf, 0, HEADER_BYTES, 0);
		return buf.subarray(0, bytesRead).toString('utf8');
	} finally {
		await fh.close();
	}
}

async function checkScript(firstmateDir: string, s: SupportedScript): Promise<ScriptCheck> {
	const file = scriptPath(firstmateDir, s.name);
	const base = { name: s.name, path: file, purpose: s.purpose };
	try {
		const st = await stat(file);
		if (!st.isFile()) return { ...base, ok: false, problem: `${s.name} is not a file` };
	} catch {
		return { ...base, ok: false, problem: `${s.name} is missing` };
	}
	try {
		await access(file, constants.X_OK);
	} catch {
		return { ...base, ok: false, problem: `${s.name} is not executable` };
	}
	let text: string;
	try {
		text = await readHead(file);
	} catch (e) {
		return { ...base, ok: false, problem: `${s.name} could not be read: ${(e as Error).message}` };
	}
	const missing = s.markers.filter((m) => !text.includes(m));
	if (missing.length) {
		return {
			...base,
			ok: false,
			problem: `${s.name} does not declare the contract this Wheelhouse reads (missing ${missing
				.map((m) => JSON.stringify(m))
				.join(', ')})`
		};
	}
	return { ...base, ok: true, problem: null };
}

/** Best-effort short commit of the Firstmate checkout, for display only. */
async function firstmateVersion(firstmateDir: string): Promise<string | null> {
	const r = await runBounded(
		'git',
		['--no-optional-locks', '-C', firstmateDir, 'rev-parse', '--short', 'HEAD'],
		{ timeoutMs: 3000, maxOutputBytes: 1024 }
	);
	return r.ok ? r.stdout.trim() || null : null;
}

/** Check the installed Firstmate's integration scripts against SUPPORTED_SCRIPTS. */
export async function checkCompatibility(install: FirstmateInstall): Promise<Compatibility> {
	const [scripts, version] = await Promise.all([
		Promise.all(SUPPORTED_SCRIPTS.map((s) => checkScript(install.firstmateDir, s))),
		firstmateVersion(install.firstmateDir)
	]);
	const problems = scripts.flatMap((s) => (s.problem ? [s.problem] : []));
	return {
		compatible: problems.length === 0,
		checkedAt: new Date().toISOString(),
		firstmateVersion: version,
		scripts,
		problems
	};
}
