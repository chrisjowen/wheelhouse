import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { lstat, mkdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Git } from './install';

/**
 * Wheelhouse's own clones of the plugin registries it reads: one shallow clone
 * per registry, under the state directory, read from disk and brought up to
 * date (fetched and moved to what the registry's ref names now) when asked.
 * A clone is only ever read: nothing in it is run, no hooks, no submodules,
 * and a file is read only when it is a plain file inside the clone (a symbolic
 * link out of it is refused).
 */

/** How long a git step may take before it is given up. */
export const GIT_TIMEOUT_MS = 60_000;

/** What a clone's last update left, kept beside it. */
export interface SyncRecord {
	/** When it was last brought up to date. */
	syncedAt: number | null;
	/** When it was last tried. */
	attemptedAt: number | null;
	/** Why the last try failed; null when it did not. */
	error: string | null;
	/** The last try failed because the repository, or its ref, is not there. */
	notFound: boolean;
	/** The commit the clone is at. */
	commit: string | null;
}

export const NO_RECORD: SyncRecord = {
	syncedAt: null,
	attemptedAt: null,
	error: null,
	notFound: false,
	commit: null
};

/** Runs git with no prompts and a time limit; a step that overruns fails. */
export const runGitTimed =
	(timeoutMs = GIT_TIMEOUT_MS): Git =>
	(args, cwd) =>
		new Promise((resolve) => {
			execFile(
				'git',
				args,
				{
					cwd,
					timeout: timeoutMs,
					env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_LFS_SKIP_SMUDGE: '1' },
					maxBuffer: 4 * 1024 * 1024
				},
				(err, stdout, stderr) =>
					resolve({
						code: err ? (typeof err.code === 'number' ? err.code : 1) : 0,
						stdout: String(stdout),
						stderr:
							err && (err as { killed?: boolean }).killed
								? `timed out after ${Math.round(timeoutMs / 1000)} seconds`
								: String(stderr)
					})
			);
		});

/** Settings for every git step on a clone: nothing in it runs. */
const SAFE = [
	'-c',
	'core.hooksPath=/dev/null',
	'-c',
	'advice.detachedHead=false',
	'-c',
	'submodule.recurse=false'
];

const lastLine = (s: string) =>
	s
		.trim()
		.split('\n')
		.map((l) => l.replace(/^(fatal|error):\s*/i, '').trim())
		.filter(Boolean)
		.pop() ?? '';

/** Why a fetch failed, in plain words, and whether the repository or its ref is not there. */
export function fetchFailure(
	stderr: string,
	ref: string | null
): { error: string; notFound: boolean } {
	const why = lastLine(stderr);
	if (/timed out after/i.test(why)) return { error: `It did not answer: ${why}.`, notFound: false };
	if (/couldn't find remote ref|not our ref|unadvertised object/i.test(stderr)) {
		return {
			error: `It has no ${ref ? `"${ref}"` : 'default'} branch, tag or commit to read.`,
			notFound: true
		};
	}
	if (
		/repository not found|could not read username|authentication failed|terminal prompts disabled|does not appear to be a git repository|not found/i.test(
			stderr
		)
	) {
		return {
			error: 'There is no such repository on GitHub, or it is not public.',
			notFound: true
		};
	}
	return { error: `It could not be fetched: ${why || 'git failed'}.`, notFound: false };
}

const SHA = /^[0-9a-f]{40}$/i;

/**
 * Bring the clone at `dir` up to date with `url` at `ref` (its default branch
 * when null): fetch only that commit and move the clone to it, whether the ref
 * moved forward or was rewritten. Without a clone, or when the one there cannot
 * be moved, make a fresh one beside it and swap it in, so a failed update
 * leaves the last good copy as it was. Never throws.
 */
export async function syncClone(
	dir: string,
	url: string,
	ref: string | null,
	git: Git
): Promise<{ ok: true; commit: string } | { ok: false; error: string; notFound: boolean }> {
	const want = ref ?? 'HEAD';
	const fetchArgs = (depth: boolean) => [
		...SAFE,
		'fetch',
		'-q',
		'--no-tags',
		'--no-recurse-submodules',
		...(depth ? ['--depth', '1'] : []),
		url,
		want
	];
	const moveTo = async (at: string) => {
		const co = await git([...SAFE, 'checkout', '-q', '-f', '--detach', 'FETCH_HEAD'], at);
		if (co.code !== 0) return null;
		await git([...SAFE, 'clean', '-q', '-f', '-d', '-x'], at);
		const head = await git(['rev-parse', 'HEAD'], at);
		return head.code === 0 ? head.stdout.trim() : null;
	};

	if (await isDir(path.join(dir, '.git'))) {
		const f = await git(fetchArgs(true), dir);
		if (f.code !== 0 && !(ref && SHA.test(ref)))
			return { ok: false, ...fetchFailure(f.stderr, ref) };
		if (f.code === 0) {
			const commit = await moveTo(dir);
			if (commit) return { ok: true, commit };
		}
		// A clone that would not move (or a commit only a full fetch finds): clone afresh.
	}

	const tmp = `${dir}.tmp-${randomBytes(4).toString('hex')}`;
	try {
		await mkdir(tmp, { recursive: true });
		const init = await git(['init', '-q'], tmp);
		if (init.code !== 0)
			return {
				ok: false,
				error: `git could not start a clone: ${lastLine(init.stderr)}.`,
				notFound: false
			};
		let f = await git(fetchArgs(true), tmp);
		// A commit a server will not hand out shallowly: fetch its history.
		if (f.code !== 0 && ref && SHA.test(ref)) f = await git(fetchArgs(false), tmp);
		if (f.code !== 0) return { ok: false, ...fetchFailure(f.stderr, ref) };
		const commit = await moveTo(tmp);
		if (!commit)
			return { ok: false, error: 'git could not check out what it fetched.', notFound: false };
		await rm(dir, { recursive: true, force: true });
		await mkdir(path.dirname(dir), { recursive: true });
		await rename(tmp, dir);
		return { ok: true, commit };
	} catch (e) {
		return {
			ok: false,
			error: `The clone could not be kept: ${(e as Error).message}.`,
			notFound: false
		};
	} finally {
		await rm(tmp, { recursive: true, force: true }).catch(() => {});
	}
}

async function isDir(p: string): Promise<boolean> {
	try {
		return (await lstat(p)).isDirectory();
	} catch {
		return false;
	}
}

/** Whether there is a clone at `dir`. */
export const hasClone = (dir: string) => isDir(path.join(dir, '.git'));

const inside = (root: string, p: string) => p === root || p.startsWith(root + path.sep);

/**
 * A plain file inside `root` (a clone), at most `maxBytes`: what it holds, or
 * why not. `missing` when there is no such file. A path that leads out of the
 * clone, by `..` or a symbolic link, is refused.
 */
export async function readCloneFile(
	root: string,
	rel: string,
	maxBytes: number
): Promise<{ ok: true; body: Buffer } | { ok: false; missing: boolean; error: string }> {
	let realRoot: string;
	let real: string;
	try {
		realRoot = await realpath(root);
		real = await realpath(path.resolve(root, rel));
	} catch (e) {
		const missing = (e as NodeJS.ErrnoException).code === 'ENOENT';
		return { ok: false, missing, error: missing ? 'not there' : (e as Error).message };
	}
	if (!inside(realRoot, real) || inside(path.join(realRoot, '.git'), real)) {
		return { ok: false, missing: false, error: 'it leads out of the registry' };
	}
	try {
		const st = await lstat(real);
		if (!st.isFile()) return { ok: false, missing: false, error: 'it is not a file' };
		if (st.size > maxBytes) return { ok: false, missing: false, error: 'it is too large' };
		return { ok: true, body: await readFile(real) };
	} catch (e) {
		return { ok: false, missing: false, error: (e as Error).message };
	}
}

/** What the last update of the clone `id` left, from beside it; no record when there is none. */
export async function readSyncRecord(cacheDir: string, id: string): Promise<SyncRecord> {
	try {
		const raw = JSON.parse(await readFile(path.join(cacheDir, `${id}.json`), 'utf8')) as Record<
			string,
			unknown
		>;
		const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
		return {
			syncedAt: num(raw.syncedAt),
			attemptedAt: num(raw.attemptedAt),
			error: typeof raw.error === 'string' ? raw.error : null,
			notFound: raw.notFound === true,
			commit: typeof raw.commit === 'string' ? raw.commit : null
		};
	} catch {
		return { ...NO_RECORD };
	}
}

export async function writeSyncRecord(cacheDir: string, id: string, r: SyncRecord): Promise<void> {
	await mkdir(cacheDir, { recursive: true });
	const file = path.join(cacheDir, `${id}.json`);
	const tmp = `${file}.tmp-${randomBytes(4).toString('hex')}`;
	await writeFile(tmp, JSON.stringify(r) + '\n');
	await rename(tmp, file);
}

/** Forget the clone `id`: its copy and its record. */
export async function removeClone(cacheDir: string, id: string): Promise<void> {
	await rm(path.join(cacheDir, id), { recursive: true, force: true });
	await rm(path.join(cacheDir, `${id}.json`), { force: true });
}
