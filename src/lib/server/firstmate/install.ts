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

/** The home the setup wizard remembered (see src/lib/server/setup/remembered.ts). */
export interface RememberedInstall {
	firstmate: string;
	home?: string | null;
}

export interface ResolveInput {
	firstmate?: string;
	home?: string;
	cwd: string;
	env: NodeJS.ProcessEnv;
	/** The setup wizard's remembered home, used when nothing else names one. */
	remembered?: RememberedInstall | null;
}

/** Where the code directory came from: --firstmate, the folder Wheelhouse ran in, or the wizard. */
export type InstallSource = 'flag' | 'cwd' | 'remembered';

export type ResolveResult =
	| { ok: true; install: FirstmateInstall; notes: string[]; source: InstallSource }
	| {
			ok: false;
			error: string;
			/**
			 * Nothing named a Firstmate and none was found: the setup wizard can help.
			 * False when a flag or remembered path was given but is wrong.
			 */
			missing: boolean;
	  };

const expandHome = (p: string, env: NodeJS.ProcessEnv) =>
	p === '~' || p.startsWith('~/') ? path.join(env.HOME ?? '', p.slice(1)) : p;

/** Why `dir` cannot be used as a Firstmate code directory, or null when it can. */
export function notFirstmate(dir: string): string | null {
	if (!isDir(dir)) return `Firstmate directory not found: ${dir}`;
	if (!looksLikeFirstmate(dir)) {
		return `${dir} is not a Firstmate checkout (bin/fm-fleet-snapshot.sh is missing).`;
	}
	return null;
}

/**
 * Resolve the Firstmate code directory and operational home.
 *
 * Code directory: --firstmate, else the nearest Firstmate checkout above cwd,
 * else the one the setup wizard remembered.
 * Home: --home, else $FM_HOME, else the remembered home (only with the
 * remembered code directory), else the code directory (Firstmate's own default).
 */
export function resolveInstall(input: ResolveInput): ResolveResult {
	const notes: string[] = [];
	let firstmateDir: string;
	let source: InstallSource;
	if (input.firstmate) {
		firstmateDir = path.resolve(input.cwd, expandHome(input.firstmate, input.env));
		const wrong = notFirstmate(firstmateDir);
		if (wrong) return { ok: false, error: wrong, missing: false };
		source = 'flag';
	} else {
		const found = findFirstmateDir(input.cwd);
		if (found) {
			firstmateDir = found;
			source = 'cwd';
			notes.push(`Found Firstmate at ${firstmateDir}`);
		} else if (input.remembered) {
			firstmateDir = path.resolve(input.remembered.firstmate);
			const wrong = notFirstmate(firstmateDir);
			if (wrong) {
				return {
					ok: false,
					error: `The Firstmate that setup remembered is gone. ${wrong}`,
					missing: true
				};
			}
			source = 'remembered';
			notes.push(`Using the Firstmate setup remembered: ${firstmateDir}`);
		} else {
			return {
				ok: false,
				error:
					'Could not find a Firstmate checkout. Run wheelhouse inside one, pass --firstmate <dir>, or set one up from the page.',
				missing: true
			};
		}
	}

	let homeDir: string;
	if (input.home) {
		homeDir = path.resolve(input.cwd, expandHome(input.home, input.env));
	} else if (input.env.FM_HOME) {
		homeDir = path.resolve(input.cwd, expandHome(input.env.FM_HOME, input.env));
		notes.push(`Using the operational home from FM_HOME: ${homeDir}`);
	} else if (source === 'remembered' && input.remembered?.home) {
		homeDir = path.resolve(input.remembered.home);
	} else {
		homeDir = firstmateDir;
	}
	const flagged = Boolean(input.home || input.env.FM_HOME);
	if (!isDir(homeDir)) {
		return { ok: false, error: `Firstmate home not found: ${homeDir}`, missing: !flagged };
	}
	if (!isDir(path.join(homeDir, 'state'))) {
		return {
			ok: false,
			error: `${homeDir} is not a Firstmate operational home (it has no state/ directory). Pass --home <dir>.`,
			missing: !flagged && source !== 'flag'
		};
	}
	return { ok: true, install: { firstmateDir, homeDir }, notes, source };
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
