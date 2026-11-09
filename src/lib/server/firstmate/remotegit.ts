import { runBounded, type RunResult } from './exec';
import {
	changedFilesOf,
	FILE_DIFF_MAX_BYTES,
	fileDiffArgs,
	fileDiffOf,
	WORKTREE_GONE
} from './evidence';
import type { FileChange, FileDiff, TaskEvidence } from '../../types';

/**
 * A remote second mate's task worktree, read as Wheelhouse reads a worktree
 * on this computer (evidence.ts): `git diff` against the merge base with its
 * base branch, uncommitted and untracked files included, and one file's diff
 * at a time. The git runs on the second mate's host, over its own SSH alias
 * (the one `data/secondmates.md` names and fm-on.sh and the preview forwards
 * use), with the same options fm-on.sh gives ssh: the alias's own keys and
 * host-key policy, never a password prompt (BatchMode), no agent, X11, port
 * forwards or environment sent.
 *
 * Strictly read-only. The command run there is one of two fixed POSIX sh
 * scripts written here; the worktree (from the task's recorded meta, checked
 * by safeWorktree) and git's arguments are passed to it as positional
 * parameters, each single-quoted, never spliced into the script. git runs
 * with --no-optional-locks, so not even the index is refreshed, and nothing
 * fetches. Output and time are bounded; ssh's exit 255 (the host could not
 * be reached) reads as offline.
 */

/** An SSH alias as data/secondmates.md and fm-on.sh accept one. */
export const SSH_ALIAS = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
/** fm-on.sh and ssh: the host could not be reached, or the command's end is unknown. */
const SSH_UNREACHABLE = 255;
/** The most a worktree's changed-files answer may be. */
const LIST_MAX_BYTES = 2 * 1024 * 1024;
const WORKTREE_MAX = 4096;

/**
 * The changed-files script: the base branch as readDiff finds it, the merge
 * base, then numstat, name-status, branch and untracked files, each ended by
 * a NUL (which git's text output never holds). Exit 3: no such worktree; 4:
 * no base branch; 5: no merge base; 6: git diff failed.
 */
export const LIST_SCRIPT = [
	'cd -- "$1" 2>/dev/null || exit 3',
	'GIT_OPTIONAL_LOCKS=0 GIT_TERMINAL_PROMPT=0; export GIT_OPTIONAL_LOCKS GIT_TERMINAL_PROMPT',
	'b=$(git --no-optional-locks symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null)',
	'if [ -z "$b" ]; then',
	'  for c in origin/main origin/master main master; do',
	'    if git --no-optional-locks rev-parse --verify --quiet "$c" >/dev/null 2>&1; then b=$c; break; fi',
	'  done',
	'fi',
	'[ -n "$b" ] || exit 4',
	'm=$(git --no-optional-locks merge-base HEAD "$b" 2>/dev/null) || exit 5',
	'[ -n "$m" ] || exit 5',
	'printf \'%s\\0%s\\0\' "$b" "$m"',
	'git --no-optional-locks diff --numstat -M "$m" || exit 6',
	"printf '\\0'",
	'git --no-optional-locks diff --name-status -M "$m" || exit 6',
	"printf '\\0'",
	'git --no-optional-locks rev-parse --abbrev-ref HEAD 2>/dev/null',
	"printf '\\0'",
	'git --no-optional-locks ls-files --others --exclude-standard 2>/dev/null',
	"printf '\\0'"
].join('\n');

/** The one-file script: git with the given arguments (fileDiffArgs) in the worktree. Exit 3: no such worktree. */
export const FILE_SCRIPT = [
	'cd -- "$1" 2>/dev/null || exit 3',
	'shift',
	'GIT_OPTIONAL_LOCKS=0 GIT_TERMINAL_PROMPT=0; export GIT_OPTIONAL_LOCKS GIT_TERMINAL_PROMPT',
	'exec git --no-optional-locks "$@"'
].join('\n');

/** One word for a POSIX shell, single-quoted. */
export function shQuote(s: string): string {
	return `'${s.replace(/'/g, `'\\''`)}'`;
}

/** The command line the remote login shell runs: `sh -c <script> wh <args...>`, every word quoted. */
export function remoteCommand(script: string, args: string[]): string {
	return ['sh', '-c', script, 'wh', ...args].map(shQuote).join(' ');
}

/** The ssh arguments for one read-only command on the alias's host. */
export function sshArgs(host: string, command: string): string[] {
	return [
		'-o',
		'BatchMode=yes',
		'-o',
		'ForwardAgent=no',
		'-o',
		'ForwardX11=no',
		'-o',
		'ClearAllForwardings=yes',
		'-o',
		'PermitLocalCommand=no',
		'-o',
		'SendEnv=-*',
		'-o',
		'ConnectTimeout=15',
		'-o',
		'ServerAliveInterval=15',
		'-o',
		'ServerAliveCountMax=3',
		'-T',
		'--',
		host,
		command
	];
}

/**
 * Whether a worktree path a task's meta records is one Wheelhouse will hand
 * to the host: absolute, no control characters, no `.`/`..` or empty parts.
 */
export function safeWorktree(p: string): boolean {
	if (!p.startsWith('/') || p.length > WORKTREE_MAX) return false;
	// eslint-disable-next-line no-control-regex
	if (/[\u0000-\u001f\u007f]/.test(p)) return false;
	return !p
		.slice(1)
		.replace(/\/$/, '')
		.split('/')
		.some((part) => part === '' || part === '.' || part === '..');
}

const isMergeBase = (s: string) => /^[0-9a-f]{40}([0-9a-f]{24})?$/.test(s);

export type RemoteFiles = { files: TaskEvidence['files']; offline: boolean };
export type RemoteFileDiff = { diff: FileDiff; offline: boolean };

export interface RemoteGitOptions {
	/** The ssh binary (default `ssh` on PATH). */
	ssh?: string;
	env?: NodeJS.ProcessEnv;
	listTimeoutMs?: number;
	fileTimeoutMs?: number;
}

export class RemoteGit {
	constructor(private opts: RemoteGitOptions = {}) {}

	private run(host: string, script: string, args: string[], timeoutMs: number, max: number) {
		return runBounded(this.opts.ssh ?? 'ssh', sshArgs(host, remoteCommand(script, args)), {
			env: this.opts.env ?? process.env,
			timeoutMs,
			maxOutputBytes: max
		});
	}

	/** What the worktree changes against the merge base with its base branch, on `host`. */
	async changes(host: string, worktree: string, mate: string): Promise<RemoteFiles> {
		const off = (reason: string, offline = false): RemoteFiles => ({
			files: { available: false, reason },
			offline
		});
		if (!SSH_ALIAS.test(host)) return off(`Second mate ${mate}’s SSH host is not a plain alias.`);
		if (!safeWorktree(worktree)) {
			return off(`Second mate ${mate} records a worktree path Wheelhouse will not use.`);
		}
		const observedAt = new Date().toISOString();
		const r = await this.run(
			host,
			LIST_SCRIPT,
			[worktree],
			this.opts.listTimeoutMs ?? 30_000,
			LIST_MAX_BYTES
		);
		if (!r.ok) {
			if (r.kind === 'exit' && r.code === SSH_UNREACHABLE) {
				return off(
					`Offline: Wheelhouse could not reach ${host}. Wheelhouse does not try again by itself.`,
					true
				);
			}
			if (r.kind === 'exit' && r.code === 3) return off(WORKTREE_GONE);
			if (r.kind === 'exit' && r.code === 4) {
				return off('Could not find the base branch in the task worktree.');
			}
			if (r.kind === 'exit' && r.code === 5) {
				return off('Could not compare the worktree with its base branch.');
			}
			if (r.kind === 'timeout') return off(`${host} took too long to list the task’s changes.`);
			if (r.kind === 'output-limit') {
				return off('The task’s list of changed files is too large to read from its second mate.');
			}
			return off(`git diff failed in the task worktree on second mate ${mate}.`);
		}
		const parts = r.stdout.split('\0');
		if (parts.length !== 7 || !parts[0] || !isMergeBase(parts[1])) {
			return off(`Second mate ${mate}’s host answered with something unexpected.`);
		}
		const [base, mergeBase, numstat, names, branch, untracked] = parts;
		return {
			files: {
				available: true,
				source: `git diff against ${base} in the task worktree on second mate ${mate}, including uncommitted and untracked files`,
				observedAt,
				value: changedFilesOf({ base, mergeBase, numstat, names, branch, untracked })
			},
			offline: false
		};
	}

	/** One listed file's diff against the merge base, on `host`. */
	async fileDiff(
		host: string,
		worktree: string,
		mate: string,
		mergeBase: string,
		base: string,
		entry: FileChange
	): Promise<RemoteFileDiff> {
		const off = (reason: string, offline = false): RemoteFileDiff => ({
			diff: { available: false, reason },
			offline
		});
		if (!SSH_ALIAS.test(host)) return off(`Second mate ${mate}’s SSH host is not a plain alias.`);
		if (!safeWorktree(worktree) || !isMergeBase(mergeBase)) {
			return off('git diff failed in the task worktree.');
		}
		const observedAt = new Date().toISOString();
		const r: RunResult = await this.run(
			host,
			FILE_SCRIPT,
			[worktree, ...fileDiffArgs(mergeBase, entry)],
			this.opts.fileTimeoutMs ?? 20_000,
			FILE_DIFF_MAX_BYTES
		);
		if (!r.ok && r.kind === 'exit' && r.code === SSH_UNREACHABLE) {
			return off(
				`Offline: Wheelhouse could not reach ${host}. Wheelhouse does not try again by itself.`,
				true
			);
		}
		if (!r.ok && r.kind === 'exit' && r.code === 3) return off(WORKTREE_GONE);
		return {
			diff: fileDiffOf(r, entry, base, observedAt, {
				untracked: `the new, uncommitted file in the task worktree on second mate ${mate}`,
				tracked: `git diff against ${base} in the task worktree on second mate ${mate}, including uncommitted changes`
			}),
			offline: false
		};
	}
}
