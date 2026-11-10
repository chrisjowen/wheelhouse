import { lstatSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { findFirstmateDir, looksLikeFirstmate } from '../firstmate/install';
import { runBounded } from '../firstmate/exec';
import type { Run } from '../sessions/tmux';
import { isInside } from '../store/store';
import type { LocationCheck } from '../../setup';

/**
 * Where Firstmate goes. The one rule that matters: Wheelhouse clones only into
 * a folder that does not exist yet or is empty, and never overwrites, moves or
 * deletes anything already there. An existing Firstmate checkout is used as it
 * is instead.
 */

/** `~` and `~/…` expanded, then made absolute; null for an empty or relative-to-nothing path. */
export function expandPath(input: string, home: string = homedir()): string | null {
	const t = input.trim();
	if (!t) return null;
	const expanded = t === '~' ? home : t.startsWith('~/') ? path.join(home, t.slice(2)) : t;
	return path.isAbsolute(expanded) ? path.resolve(expanded) : null;
}

/** Where the wizard suggests cloning Firstmate: ~/firstmate. */
export const defaultFirstmateDir = (home: string = homedir()) => path.join(home, 'firstmate');

/**
 * The Firstmate checkouts already on this computer: first the one above `cwd`,
 * which Wheelhouse picks over any other, then the usual places that hold one.
 */
export function foundFirstmates(
	env: NodeJS.ProcessEnv,
	cwd: string,
	home: string = homedir()
): string[] {
	const candidates = [
		findFirstmateDir(cwd),
		env.FM_HOME,
		path.join(home, 'firstmate'),
		path.join(home, 'fm-home'),
		path.join(home, 'src', 'firstmate'),
		path.join(home, 'code', 'firstmate'),
		path.join(home, 'projects', 'firstmate'),
		path.join(home, 'dev', 'firstmate')
	];
	const out: string[] = [];
	for (const c of candidates) {
		if (!c) continue;
		const dir = path.resolve(c);
		if (!out.includes(dir) && looksLikeFirstmate(dir)) out.push(dir);
	}
	return out;
}

export interface LocationOptions {
	/** Wheelhouse's own folders (state, config, plugins), which a Firstmate home must not contain. */
	ownDirs: string[];
	home?: string;
}

/** What is at `input`, and whether Firstmate can be cloned there or used from there. */
export function checkLocation(input: string, opts: LocationOptions): LocationCheck {
	const dir = expandPath(input, opts.home);
	if (!dir) {
		return {
			dir: input,
			kind: 'invalid',
			message: 'Give a full path, such as ~/firstmate or /Users/you/firstmate.'
		};
	}
	if (dir === path.parse(dir).root) {
		return { dir, kind: 'invalid', message: 'Pick a folder, not the top of the disk.' };
	}
	for (const own of opts.ownDirs) {
		if (isInside(own, dir)) {
			return {
				dir,
				kind: 'invalid',
				message: `${own} is Wheelhouse’s own folder; a Firstmate home cannot contain it.`
			};
		}
		if (isInside(dir, own)) {
			return {
				dir,
				kind: 'invalid',
				message: `That is inside Wheelhouse’s own folder ${own}; pick one outside it.`
			};
		}
	}
	let st;
	try {
		st = lstatSync(dir);
	} catch (e) {
		if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
			return {
				dir,
				kind: 'invalid',
				message: `Wheelhouse cannot look there: ${(e as Error).message}`
			};
		}
		const parent = nearestExisting(path.dirname(dir));
		if (!parent || !statSync(parent).isDirectory()) {
			return { dir, kind: 'invalid', message: `${path.dirname(dir)} is not a folder.` };
		}
		return {
			dir,
			kind: 'new',
			message: `Nothing is there yet: Firstmate will be cloned to ${dir}.`
		};
	}
	if (st.isSymbolicLink()) {
		return {
			dir,
			kind: 'occupied',
			message: `${dir} is a link. Wheelhouse never clones over one; pick another folder or the folder it points to.`
		};
	}
	if (!st.isDirectory()) {
		return {
			dir,
			kind: 'occupied',
			message: `${dir} is a file. Wheelhouse never overwrites anything; pick another folder.`
		};
	}
	if (looksLikeFirstmate(dir)) {
		return { dir, kind: 'firstmate', message: `Firstmate is already there: use it as it is.` };
	}
	let entries: string[];
	try {
		entries = readdirSync(dir);
	} catch (e) {
		return {
			dir,
			kind: 'invalid',
			message: `Wheelhouse cannot read ${dir}: ${(e as Error).message}`
		};
	}
	if (entries.length === 0) {
		return { dir, kind: 'empty', message: `${dir} is empty: Firstmate will be cloned into it.` };
	}
	return {
		dir,
		kind: 'occupied',
		message: `${dir} already has files in it and is not Firstmate. Wheelhouse never overwrites anything; pick a new or empty folder.`
	};
}

function nearestExisting(p: string): string | null {
	let dir = p;
	for (;;) {
		try {
			lstatSync(dir);
			return dir;
		} catch {
			const up = path.dirname(dir);
			if (up === dir) return null;
			dir = up;
		}
	}
}

export interface CloneOptions extends LocationOptions {
	git: string;
	repository: string;
	env: NodeJS.ProcessEnv;
	run?: Run;
}

export type CloneResult = { ok: true; dir: string; output: string } | { ok: false; error: string };

const CLONE_TIMEOUT_MS = 5 * 60_000;

/**
 * Clone Firstmate to `input`, which must be new or empty when it is checked
 * again here, just before. A new folder is made first, refusing if anything
 * appeared there meanwhile, and `git clone` itself refuses a folder that is not
 * empty. Then the operational home's `state/` is made, as Firstmate's own lock
 * would make it on its first start.
 */
export async function cloneFirstmate(input: string, opts: CloneOptions): Promise<CloneResult> {
	const at = checkLocation(input, opts);
	if (at.kind !== 'new' && at.kind !== 'empty') return { ok: false, error: at.message };
	const dir = at.dir;
	if (at.kind === 'new') {
		try {
			mkdirSync(path.dirname(dir), { recursive: true });
			// Not recursive: fails if the folder appeared since the check.
			mkdirSync(dir);
		} catch (e) {
			return { ok: false, error: `Wheelhouse could not make ${dir}: ${(e as Error).message}` };
		}
	}
	const run = opts.run ?? runBounded;
	const r = await run(opts.git, ['clone', '--', opts.repository, dir], {
		env: { ...opts.env, GIT_TERMINAL_PROMPT: '0' },
		timeoutMs: CLONE_TIMEOUT_MS,
		maxOutputBytes: 256 * 1024,
		maxErrorBytes: 256 * 1024
	});
	if (!r.ok) {
		const why = (r.stderr || r.message).trim().split('\n').slice(-3).join(' ');
		return { ok: false, error: `git clone failed: ${why}` };
	}
	if (!looksLikeFirstmate(dir)) {
		return {
			ok: false,
			error: `${opts.repository} was cloned to ${dir}, but it does not look like Firstmate (bin/fm-fleet-snapshot.sh is missing).`
		};
	}
	try {
		mkdirSync(path.join(dir, 'state'), { recursive: true });
	} catch (e) {
		return { ok: false, error: `Cloned, but could not make ${dir}/state: ${(e as Error).message}` };
	}
	return { ok: true, dir, output: `${r.stdout}${r.stderr}`.trim() };
}
