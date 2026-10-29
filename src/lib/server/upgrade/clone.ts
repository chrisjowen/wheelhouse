import { execFile } from 'node:child_process';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import type { UpdateCheck, UpgradeStep } from '../../updates';
import { runGit, type Git } from '../plugins/install';

/**
 * Upgrading Wheelhouse itself, when it runs from a git clone (the installed
 * `wheelhouse` linked to a checkout): fetch the default branch of the clone's
 * `origin`, say what is new, and fast-forward to it, reinstall and rebuild.
 * Restarting is the caller's (the CLI asks the running Wheelhouse, the server
 * restarts itself). It never resets, stashes, merges or rebases: a clone with
 * local changes, on another branch or with commits of its own is left as it
 * is, with the reason.
 */

export type { Commit, UpdateCheck, UpgradeStep } from '../../updates';

export type Run = (
	cmd: string,
	args: string[],
	cwd: string
) => Promise<{ code: number; output: string }>;

export interface CloneDeps {
	/** The directory Wheelhouse runs from. */
	dir: string;
	git?: Git;
	/** Runs npm; tests stand one in. */
	run?: Run;
	now?: () => Date;
}

export const COMMITS_SHOWN = 20;
const OUTPUT_KEPT = 60_000;

export const runCommand: Run = (cmd, args, cwd) =>
	new Promise((resolve) => {
		execFile(cmd, args, { cwd, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
			const output = `${String(stdout)}${String(stderr)}`;
			resolve({
				code: err ? (typeof err.code === 'number' ? err.code : 1) : 0,
				output: output.slice(-OUTPUT_KEPT)
			});
		});
	});

/** `org/repo` from a GitHub remote URL (https, ssh or scp-like), else null. */
export function githubRepository(url: string): string | null {
	const m =
		/^(?:https?:\/\/(?:[^@/]+@)?github\.com\/|(?:ssh:\/\/)?git@github\.com[:/])([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(
			url.trim()
		);
	return m ? `${m[1]}/${m[2]}` : null;
}

function packageVersion(text: string | null): string | null {
	if (text === null) return null;
	try {
		const v = (JSON.parse(text) as { version?: unknown }).version;
		return typeof v === 'string' ? v : null;
	} catch {
		return null;
	}
}

const lastLine = (s: string) => s.trim().split('\n').pop() ?? '';

/** Fetch the default branch and compare the clone with it. Changes nothing but the fetched refs. */
export async function checkClone(deps: CloneDeps): Promise<UpdateCheck> {
	const git = deps.git ?? runGit;
	const g = async (...args: string[]) => git(args, deps.dir);
	const out: UpdateCheck = {
		schema: 'wheelhouse-update.v1',
		checkedAt: (deps.now?.() ?? new Date()).toISOString(),
		state: 'unsupported',
		reason: null,
		dir: deps.dir,
		repository: null,
		branch: null,
		current: { commit: null, version: null },
		latest: null,
		commits: [],
		behind: 0,
		changes: []
	};
	out.current.version = packageVersion(
		await readFile(path.join(deps.dir, 'package.json'), 'utf8').catch(() => null)
	);

	const top = await g('rev-parse', '--show-toplevel');
	const here = await realpath(deps.dir).catch(() => deps.dir);
	if (top.code !== 0 || (await realpath(top.stdout.trim()).catch(() => '')) !== here) {
		out.reason = `${deps.dir} is not a git clone, so Wheelhouse cannot upgrade it; update it the way it was installed (for npm, \`npm install -g @chrisjowen/wheelhouse\`)`;
		return out;
	}
	const head = await g('rev-parse', 'HEAD');
	out.current.commit = head.code === 0 ? head.stdout.trim() : null;
	const origin = await g('remote', 'get-url', 'origin');
	if (origin.code !== 0) {
		out.reason = `${deps.dir} has no origin remote to upgrade from`;
		return out;
	}
	out.repository = githubRepository(origin.stdout);

	const symref = await g('ls-remote', '--symref', 'origin', 'HEAD');
	const branch = /^ref: refs\/heads\/(\S+)\s+HEAD$/m.exec(symref.stdout)?.[1] ?? null;
	if (symref.code !== 0 || !branch) {
		out.state = 'error';
		out.reason = `could not reach origin: ${lastLine(symref.stderr) || 'it named no default branch'}`;
		return out;
	}
	out.branch = branch;
	const fetched = await g('fetch', '--quiet', '--no-tags', 'origin', `refs/heads/${branch}`);
	if (fetched.code !== 0) {
		out.state = 'error';
		out.reason = `could not fetch ${branch}: ${lastLine(fetched.stderr)}`;
		return out;
	}
	const latest = (await g('rev-parse', 'FETCH_HEAD')).stdout.trim();
	const remotePkg = await g('show', `${latest}:package.json`);
	out.latest = {
		commit: latest,
		version: packageVersion(remotePkg.code === 0 ? remotePkg.stdout : null)
	};

	const counts = (await g('rev-list', '--left-right', '--count', `HEAD...${latest}`)).stdout
		.trim()
		.split(/\s+/)
		.map(Number);
	const ahead = counts[0] || 0;
	out.behind = counts[1] || 0;
	if (out.behind === 0) {
		out.state = 'current';
		return out;
	}
	const log = await g('log', '--format=%H%x1f%s%x1f%cI', `-n${COMMITS_SHOWN}`, `HEAD..${latest}`);
	out.commits = log.stdout
		.split('\n')
		.filter(Boolean)
		.map((l) => {
			const [sha, subject, date] = l.split('\x1f');
			return { sha, subject, date };
		});

	const on = await g('symbolic-ref', '--quiet', '--short', 'HEAD');
	const status = await g('status', '--porcelain', '--untracked-files=no');
	const changes = status.stdout.split('\n').filter((l) => l.trim());
	out.state = 'refused';
	if (on.code !== 0) {
		out.reason = `${deps.dir} is not on a branch (detached HEAD), so it cannot fast-forward to ${branch}`;
	} else if (on.stdout.trim() !== branch) {
		out.reason = `${deps.dir} is on ${on.stdout.trim()}, not ${branch}, so it cannot fast-forward`;
	} else if (changes.length) {
		out.reason = `${deps.dir} has local changes; commit or discard them, then check again`;
		out.changes = changes;
	} else if (ahead > 0) {
		out.reason = `${deps.dir} has ${ahead} commit${ahead === 1 ? '' : 's'} that ${branch} does not, so it cannot fast-forward`;
	} else {
		out.state = 'available';
	}
	return out;
}

export type UpgradeOutcome =
	| { ok: true; check: UpdateCheck; from: string | null; to: string }
	| { ok: false; step: UpgradeStep; error: string; output: string; check: UpdateCheck | null };

/**
 * Check again, then fast-forward, `npm ci` and `npm run build`. Refuses, having
 * changed nothing, unless the check finds newer commits the clone can take.
 * Both run in the directory the server runs from, so a failed install or build
 * leaves the clone at the new commit with an incomplete build that must be
 * rebuilt before Wheelhouse restarts.
 */
export async function upgradeClone(
	deps: CloneDeps,
	onStep: (step: UpgradeStep) => void = () => {}
): Promise<UpgradeOutcome> {
	const git = deps.git ?? runGit;
	const run = deps.run ?? runCommand;
	onStep('fetch');
	const check = await checkClone(deps);
	if (check.state !== 'available' || !check.latest) {
		const error =
			check.state === 'current'
				? `Wheelhouse is already up to date with ${check.branch}`
				: (check.reason ?? 'there is nothing to upgrade to');
		return { ok: false, step: 'fetch', error, output: '', check };
	}
	onStep('fast-forward');
	const ff = await git(['merge', '--ff-only', '--quiet', check.latest.commit], deps.dir);
	if (ff.code !== 0) {
		return {
			ok: false,
			step: 'fast-forward',
			error: `could not fast-forward: ${lastLine(ff.stderr)}`,
			output: ff.stderr,
			check
		};
	}
	for (const [step, args] of [
		['install', ['ci']],
		['build', ['run', 'build']]
	] as const) {
		onStep(step);
		const r = await run('npm', [...args], deps.dir);
		if (r.code !== 0) {
			return {
				ok: false,
				step,
				error: `npm ${args.join(' ')} failed (exit ${r.code}); the clone is at ${check.latest.commit.slice(0, 7)} but its build is incomplete, so rebuild it (npm ci && npm run build) before Wheelhouse restarts`,
				output: r.output,
				check
			};
		}
	}
	return { ok: true, check, from: check.current.commit, to: check.latest.commit };
}
