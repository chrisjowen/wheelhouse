import { hostLabel, unreachable } from '../../matelink';
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

/**
 * The task script (RemoteGit.taskRead): one read of a task in a second mate's
 * home. $1 the home, $2 the task id, $3-$5 the most of its status log (its
 * end), brief (its start; 0: not read) and meta file (its start) sent, $6 the
 * worktree to list (empty: the one its meta records; `-`: none), $7
 * LIST_SCRIPT. Each file is read only when it is a regular file, not a
 * symlink, in a directory that resolves inside the home, as fm-remote-file.sh
 * reads one. The answer is four parts in order (status, meta, brief, git),
 * each a header line and then exactly as many bytes as it says:
 *
 *     <name> ok <size> <sent>    the file, <size> bytes, of which <sent> follow
 *     <name> none 0 0            no such file (or not one Wheelhouse reads)
 *     git <exit> <sent> <path>   LIST_SCRIPT's exit and output in <path>
 *     git - 0                    no worktree listed
 *
 * Exit 3: no such home.
 */
export const TASK_SCRIPT = [
	'h=$(CDPATH= cd -P -- "$1" 2>/dev/null && pwd) || exit 3',
	'd=$(mktemp -d "${TMPDIR:-/tmp}/wh-task.XXXXXX") || exit 7',
	'trap \'rm -rf -- "$d"\' EXIT',
	'part() {',
	'  : > "$d/$1"',
	'  p=$(CDPATH= cd -P -- "$h/${2%/*}" 2>/dev/null && pwd) || p=',
	'  case $p in "$h"|"$h"/*) f=$p/${2##*/} ;; *) f= ;; esac',
	'  if [ -z "$f" ] || [ ! -f "$f" ] || [ -L "$f" ]; then printf \'%s none 0 0\\n\' "$1"; return; fi',
	'  if [ "$4" = tail ]; then tail -c "$3" "$f" > "$d/$1" 2>/dev/null; else head -c "$3" "$f" > "$d/$1" 2>/dev/null; fi',
	'  s=$(wc -c < "$f" 2>/dev/null | tr -d \' \') ; n=$(wc -c < "$d/$1" | tr -d \' \')',
	'  printf \'%s ok %s %s\\n\' "$1" "${s:-$n}" "$n"',
	'  cat "$d/$1"',
	'}',
	'part status "state/$2.status" "$3" tail',
	'part meta "state/$2.meta" "$5" head',
	'if [ "$4" -gt 0 ]; then part brief "data/$2/brief.md" "$4" head; else printf \'brief none 0 0\\n\'; fi',
	'w=$6',
	'if [ -z "$w" ]; then w=$(sed -n \'s/^worktree=//p\' "$d/meta" | tail -n 1); fi',
	'case $w in',
	"  -|'') printf 'git - 0\\n' ;;",
	'  /*) sh -c "$7" wh "$w" > "$d/git" 2>/dev/null; c=$?',
	'     printf \'git %s %s %s\\n\' "$c" "$(wc -c < "$d/git" | tr -d \' \')" "$w"; cat "$d/git" ;;',
	"  *) printf 'git - 0\\n' ;;",
	'esac'
].join('\n');

/** A task id as Firstmate names one (adapter.ts TASK_ID). */
const TASK_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/** What RemoteGit.taskRead reads: the bounds, and the worktree (empty: its meta's; false: none). */
export interface TaskReadWant {
	statusMax: number;
	/** 0: the brief is not read. */
	briefMax: number;
	metaMax: number;
	git: string | false;
}

/** A file read in a task's home: its text as sent and its whole size; null when it is not there. */
export type TaskFile = { text: string; size: number; sent: number } | null;

export interface TaskRead {
	/** The status log's last bytes, from its first whole line when it was cut. */
	status: TaskFile;
	meta: TaskFile;
	/** Null when not asked for or not there. */
	brief: TaskFile;
	/** The worktree listed and its changed files; null when none was listed. */
	git: { worktree: string; files: TaskEvidence['files'] } | null;
}

export type TaskReadResult =
	| { ok: true; value: TaskRead; observedAt: string }
	| {
			ok: false;
			offline: boolean;
			/** The host cannot be read this way at all (its shell refused, no such home). */
			unsupported: boolean;
			reason: string;
	  };

/** A worktree listing (LIST_SCRIPT's exit, null when it did not exit, and its output) as changed files. */
export function listedFiles(
	code: number | null,
	stdout: string,
	mate: string,
	observedAt: string
): TaskEvidence['files'] {
	const off = (reason: string): TaskEvidence['files'] => ({ available: false, reason });
	if (code === 3) return off(WORKTREE_GONE);
	if (code === 4) return off('Could not find the base branch in the task worktree.');
	if (code === 5) return off('Could not compare the worktree with its base branch.');
	if (code !== 0) return off(`git diff failed in the task worktree on second mate ${mate}.`);
	const parts = stdout.split('\0');
	if (parts.length !== 7 || !parts[0] || !isMergeBase(parts[1])) {
		return off(`Second mate ${mate}’s host answered with something unexpected.`);
	}
	const [base, mergeBase, numstat, names, branch, untracked] = parts;
	return {
		available: true,
		source: `git diff against ${base} in the task worktree on second mate ${mate}, including uncommitted and untracked files`,
		observedAt,
		value: changedFilesOf({ base, mergeBase, numstat, names, branch, untracked })
	};
}

/** TASK_SCRIPT's answer, or null when it is not one. */
export function parseTaskRead(
	out: Buffer,
	max: { status: number; brief: number; meta: number },
	mate: string,
	observedAt: string
): TaskRead | null {
	let at = 0;
	const line = (): string[] | null => {
		const nl = out.indexOf(0x0a, at);
		if (nl < 0) return null;
		const words = out.subarray(at, nl).toString('utf8').split(' ');
		at = nl + 1;
		return words;
	};
	const body = (n: number): Buffer | null => {
		if (!Number.isSafeInteger(n) || n < 0 || at + n > out.length) return null;
		const b = out.subarray(at, at + n);
		at += n;
		return b;
	};
	const file = (name: string, bound: number, tail: boolean): TaskFile | undefined => {
		const h = line();
		if (!h || h.length !== 4 || h[0] !== name) return undefined;
		if (h[1] === 'none') return null;
		const size = Number(h[2]);
		const sent = Number(h[3]);
		if (h[1] !== 'ok' || !Number.isSafeInteger(size) || sent > bound) return undefined;
		const b = body(sent);
		if (!b) return undefined;
		let text = b.toString('utf8');
		// A tail read past the file's start begins mid-line: drop that partial first line.
		if (tail && size > sent) text = text.slice(text.indexOf('\n') + 1);
		return { text, size: Math.max(size, sent), sent };
	};
	const status = file('status', max.status, true);
	const meta = file('meta', max.meta, false);
	const brief = file('brief', Math.max(max.brief, 0), false);
	if (status === undefined || meta === undefined || brief === undefined) return null;
	const g = line();
	if (!g || g[0] !== 'git') return null;
	if (g[1] === '-') return at === out.length ? { status, meta, brief, git: null } : null;
	const code = Number(g[1]);
	const b = body(Number(g[2]));
	const worktree = g.slice(3).join(' ');
	if (!Number.isInteger(code) || !b || !worktree || at !== out.length) return null;
	return {
		status,
		meta,
		brief,
		git: { worktree, files: listedFiles(code, b.toString('utf8'), mate, observedAt) }
	};
}

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
		if (!SSH_ALIAS.test(host)) return off(`Second mate ${mate}’s host is not a plain name.`);
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
		if (!r.ok && r.kind === 'exit' && r.code === SSH_UNREACHABLE) {
			return off(
				`Offline: ${unreachable(host, r.stderr)} Wheelhouse does not try again by itself.`,
				true
			);
		}
		if (!r.ok && r.kind === 'timeout')
			return off(`${hostLabel(host)} took too long to list the task’s changes.`);
		if (!r.ok && r.kind === 'output-limit') {
			return off('The task’s list of changed files is too large to read from its second mate.');
		}
		const code = r.ok ? 0 : r.kind === 'exit' ? r.code : null;
		return { files: listedFiles(code, r.stdout, mate, observedAt), offline: false };
	}

	/**
	 * Everything a page shows of a task in a remote second mate's home, in one
	 * ssh call instead of one fm-on.sh call per file: the task's status log
	 * (its last `statusMax` bytes), meta file and brief (its first `briefMax`
	 * bytes, when asked for) from the home, then its worktree's changed files,
	 * listed as `changes` lists them, in the worktree the meta records (or the
	 * one given). Read-only; see TASK_SCRIPT. Not offline but not ok means the
	 * host cannot be read this way (no such home, an old shell): the caller
	 * reads it through fm-on.sh instead.
	 */
	async taskRead(
		host: string,
		home: string,
		task: string,
		mate: string,
		want: TaskReadWant
	): Promise<TaskReadResult> {
		const fail = (reason: string, offline = false, unsupported = false): TaskReadResult => ({
			ok: false,
			offline,
			unsupported,
			reason
		});
		if (!SSH_ALIAS.test(host)) return fail(`Second mate ${mate}’s host is not a plain name.`);
		if (!safeWorktree(home)) return fail(`Second mate ${mate}’s home is not a plain path.`);
		if (!TASK_NAME.test(task)) return fail('That is not a task id.');
		const worktree = want.git === false ? '-' : want.git;
		if (worktree !== '-' && worktree !== '' && !safeWorktree(worktree)) {
			return fail(`Second mate ${mate} records a worktree path Wheelhouse will not use.`);
		}
		const max = {
			status: Math.max(1, Math.floor(want.statusMax)),
			brief: Math.max(0, Math.floor(want.briefMax)),
			meta: Math.max(1, Math.floor(want.metaMax))
		};
		const observedAt = new Date().toISOString();
		const chunks: Buffer[] = [];
		const r = await runBounded(
			this.opts.ssh ?? 'ssh',
			sshArgs(
				host,
				remoteCommand(TASK_SCRIPT, [
					home,
					task,
					String(max.status),
					String(max.brief),
					String(max.meta),
					worktree,
					LIST_SCRIPT
				])
			),
			{
				env: this.opts.env ?? process.env,
				timeoutMs: this.opts.listTimeoutMs ?? 30_000,
				maxOutputBytes: max.status + max.brief + max.meta + LIST_MAX_BYTES + 8192,
				onStdout: (c) => chunks.push(c)
			}
		);
		if (!r.ok) {
			if (r.kind === 'exit' && r.code === SSH_UNREACHABLE) {
				return fail(
					`Offline: ${unreachable(host, r.stderr)} Wheelhouse does not try again by itself.`,
					true
				);
			}
			if (r.kind === 'timeout') return fail(`${hostLabel(host)} took too long to answer.`);
			return fail(
				`Second mate ${mate}’s home could not be read in one go.`,
				false,
				r.kind !== 'output-limit'
			);
		}
		const value = parseTaskRead(Buffer.concat(chunks), max, mate, observedAt);
		return value
			? { ok: true, value, observedAt }
			: fail(`Second mate ${mate}’s host answered with something unexpected.`, false, true);
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
		if (!SSH_ALIAS.test(host)) return off(`Second mate ${mate}’s host is not a plain name.`);
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
				`Offline: ${unreachable(host, r.stderr)} Wheelhouse does not try again by itself.`,
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
