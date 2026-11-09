import { open, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { loopbackPreview, type PreviewCheck } from '../../preview';
import { plainStatus } from '../../plain';
import type { FileDiff, MateTask, SecondMate, TaskEvidence, TaskOutput } from '../../types';
import {
	PEEK_DEFAULT_LINES,
	PEEK_MAX_LINES,
	REMOTE_FILE_MAX_BYTES,
	REMOTE_UNREACHABLE,
	TASK_ID,
	type AdapterResult,
	type FirstmateAdapter,
	type MateRoute
} from './adapter';
import { metaGet } from './crew';
import { WORKTREE_GONE, type EvidenceReader } from './evidence';
import { forwardKey, type PreviewForwards } from './forwards';
import type { RemoteGit } from './remotegit';

/**
 * A task in a second mate's home, as Wheelhouse shows a task of its own: its
 * status history, pull request and preview from the task's status log in that
 * home (`state/<task>.status`, read-only: a local second mate's file directly,
 * a remote one's with `fm-on.sh <mate> fm-remote-file.sh get`), its project
 * from the task's `state/<task>.meta` there as a task of the captain's takes
 * it from its own (and from it the PR too once the log is past what
 * fm-remote-file.sh sends), its console
 * (`fm-peek.sh` in that home, over fm-on.sh for a remote one), its changed
 * files and their diffs (the worktree its meta records, read as a task of the
 * captain's is: on this computer directly, and for a remote second mate with
 * read-only git over its SSH alias, remotegit.ts), and its live
 * preview, which for a remote second mate is reached through a forward over
 * its SSH alias (forwards.ts). Feedback and preview comments go to the task's
 * own second mate, as a note in that second mate's inbox about the task
 * (adapter.mateNote), never to the captain's Firstmate and never to a task of
 * the captain's with the same id.
 *
 * Such a task is named `<task>@<second mate>` wherever a task id goes (the
 * task API routes, the preview components), which no task of the captain's
 * can be, since a task id has no `@`.
 */

export const mateTaskId = (mate: string, task: string) => `${task}@${mate}`;

export function parseMateTaskId(id: string): { mate: string; task: string } | null {
	const at = id.lastIndexOf('@');
	if (at < 0) return null;
	const task = id.slice(0, at);
	const mate = id.slice(at + 1);
	return TASK_ID.test(task) && TASK_ID.test(mate) ? { mate, task } : null;
}

/** How much of a status log is read: its last 256 KiB, as for a task of the captain's. */
export const STATUS_MAX_BYTES = 256 * 1024;
/** The largest task meta file read. */
const META_MAX_BYTES = 16 * 1024;
/** A task meta file that could not be read, or names no PR while its log is cut, is read again after this long. */
const META_RETRY_MS = 10 * 60_000;
/** fm-remote-file.sh's refusal of a file over the size it was asked for. */
const TOO_LARGE = /exceeds max-bytes/;
/** A task's changes are listed again after this long, as a task of the captain's are (evidence.ts). */
const CHANGES_TTL_MS = 30_000;
/** One file's diff is read again after this long, as a task of the captain's is (evidence.ts). */
const FILE_DIFF_TTL_MS = 15_000;
/** A status log is read again after this long. */
const STATUS_TTL_MS = 10_000;
/** In the background, a task in flight has its status log read at most this often. */
const REFRESH_MS = 60_000;
/** A remote task's console is looked at no more often than this, however many cards ask. */
const REMOTE_LOOK_MS = 5_000;
/** Background reads run this many at a time. */
const REFRESH_AT_ONCE = 2;
const PREVIEW = /^\s*preview:?\s+(https?:\/\/\S+)/i;
const PULL = /https?:\/\/[^\s)]+\/pull\/\d+/g;
const LINE = /^([A-Za-z][A-Za-z_-]*)((?:\s*\[[^\]]*\])*)\s*:\s?(.*)$/;

export interface StatusLine {
	state: string;
	text: string;
	/** When it was written (`[at=<epoch>]`), as ISO; null when it does not say. */
	at: string | null;
}

export interface MateTaskLog {
	lines: StatusLine[];
	/** The latest preview the worker reported, as it reported it (on its own host). */
	preview: { url: string; reportedAt: string | null } | null;
	/** The latest pull request any line names. */
	pr: string | null;
	/** Only the log's last STATUS_MAX_BYTES were read, so its earlier lines are missing. */
	truncated: boolean;
	/** The log is past fm-remote-file.sh's bound, so none of it was read. */
	cut: boolean;
}

/** A task's status log in a second mate's home, read as Wheelhouse reads its own workers' lines. */
export function parseStatusLog(text: string): MateTaskLog {
	const lines: StatusLine[] = [];
	let preview: MateTaskLog['preview'] = null;
	let pr: string | null = null;
	for (const raw of text.split('\n')) {
		const m = LINE.exec(raw.trim());
		if (!m) continue;
		const at = /\[at=(\d{9,11})\]/.exec(m[2])?.[1];
		const line = {
			state: m[1].toLowerCase(),
			text: m[3].trim(),
			at: at ? new Date(Number(at) * 1000).toISOString() : null
		};
		lines.push(line);
		const p = PREVIEW.exec(line.text);
		if (p) preview = { url: p[1].replace(/[),.;]+$/, ''), reportedAt: line.at };
		const prs = line.text.match(PULL);
		if (prs) pr = prs[prs.length - 1];
	}
	return { lines, preview, pr, truncated: false, cut: false };
}

/**
 * The project a task's meta file names, as a task of the captain's gets its
 * own (model.ts projectIdForTask): `repo=`, else the last part of `project=`,
 * with Firstmate's own home read as `firstmate`. Null when it names neither.
 * Each key's last value counts, as fm_meta_get reads it.
 */
export function parseMetaProject(text: string, home: string | null): string | null {
	const repo = metaGet(text, 'repo').trim();
	if (repo) return repo;
	const project = metaGet(text, 'project').trim();
	if (!project) return null;
	if (home && path.posix.resolve(project) === path.posix.resolve(home)) return 'firstmate';
	return path.posix.basename(project) || null;
}

/** The pull request a task's meta file records (`pr=`, its last value), or null. */
export function parseMetaPr(text: string): string | null {
	return metaGet(text, 'pr').trim().match(PULL)?.[0] ?? null;
}

type TaskMeta = {
	projectId: string | null;
	pr: string | null;
	/** The task's worktree and ship branch in that home (`worktree=`, `branch=`). */
	worktree: string | null;
	branch: string | null;
};

type Files = TaskEvidence['files'];

/** A read of a task's changes: the list, and the worktree it was read in. */
type ChangesRead = { files: Files; worktree: string | null; offline: boolean };

/** The last `max` bytes of a file's text, from the first whole line in them. */
function tailText(buf: Buffer, max: number): { text: string; truncated: boolean } {
	if (buf.length <= max) return { text: buf.toString('utf8'), truncated: false };
	const text = buf.subarray(buf.length - max).toString('utf8');
	// A tail read starts mid-line: drop that partial first line.
	return { text: text.slice(text.indexOf('\n') + 1), truncated: true };
}

type Found = { mate: SecondMate; task: MateTask; route: MateRoute };

export type MateLookup =
	{ ok: true; value: Found } | { ok: false; status: 404 | 409; error: string };

export type LogResult =
	| { ok: true; value: MateTaskLog; observedAt: string }
	| { ok: false; offline: boolean; reason: string };

export interface MateTasksDeps {
	adapter: Pick<FirstmateAdapter, 'remoteFile' | 'matePeekTask' | 'mateNote'>;
	/** How a local second mate's task worktree is read: as a task of the captain's (evidence.ts). */
	evidence?: Pick<EvidenceReader, 'diff' | 'fileDiff'>;
	/** How a remote second mate's task worktree is read: the same git, over its SSH alias. */
	remoteGit?: Pick<RemoteGit, 'changes' | 'fileDiff'>;
	mates: () => SecondMate[];
	forwards: Pick<PreviewForwards, 'open' | 'retain'>;
	/** Checks a preview URL the way a task of the captain's is checked (server/preview.ts). */
	check: (
		preview: { url: string; reportedAt: string } | null,
		pageOrigin: string,
		o: { landed: boolean }
	) => Promise<PreviewCheck>;
	now?: () => number;
}

const OFFLINE = (host: string | null) =>
	`Offline: Firstmate could not reach ${host ?? 'its host'}. Wheelhouse does not try again by itself.`;

/** Every task a second mate lists: in flight, queued and landed. */
const tasksOf = (m: SecondMate) => [...m.inFlight, ...m.queued, ...m.landed];

export class MateTasks {
	private logs = new Map<string, { at: number; value: Promise<LogResult> }>();
	private looks = new Map<string, Promise<TaskOutput>>();
	private seen = new Map<string, { at: number; value: TaskOutput }>();
	/** The forward each task's preview opened, by `<task>@<mate>`. */
	private opened = new Map<string, string>();
	/** The last status log read for each task, by `<task>@<mate>`, kept for its PR and preview. */
	private known = new Map<string, MateTaskLog>();
	/** Each task's meta file as last read (null: it could not be), and when, by `<task>@<mate>`. */
	private metas = new Map<string, { at: number; value: TaskMeta | null }>();
	/** Each task's last read of its changes, by `<task>@<mate>`. */
	private changeReads = new Map<string, { at: number; value: Promise<ChangesRead> }>();
	/** A remote task's file diffs as last read, by task, merge base, status and path. */
	private fileDiffs = new Map<string, { at: number; value: Promise<FileDiff> }>();
	/** How many files each task's last count read counted, for its card. */
	private counts = new Map<string, number | null>();
	/** When each task's last count read started. */
	private countedAt = new Map<string, number>();
	/** Remote tasks whose status log is over STATUS_MAX_BYTES, so read whole up to fm-remote-file.sh's bound. */
	private large = new Set<string>();
	private refreshing = false;
	/** Tasks whose count read is still out. */
	private countsInFlight = new Set<string>();
	private now: () => number;

	constructor(private deps: MateTasksDeps) {
		this.now = deps.now ?? Date.now;
	}

	/** The second mate and its task a `<task>@<mate>` id names. */
	find(id: string): MateLookup {
		const ref = parseMateTaskId(id);
		const mate = ref ? this.deps.mates().find((m) => m.id === ref.mate) : undefined;
		const task = mate ? tasksOf(mate).find((t) => t.id === ref!.task) : undefined;
		if (!ref || !mate || !task) {
			return { ok: false, status: 404, error: `There is no second mate’s task called ${id}.` };
		}
		if (mate.where === 'remote') {
			return { ok: true, value: { mate, task, route: { id: mate.id, remote: true } } };
		}
		if (!mate.home || !path.isAbsolute(mate.home)) {
			return { ok: false, status: 409, error: `Firstmate records no home for ${mate.id}.` };
		}
		return {
			ok: true,
			value: { mate, task, route: { id: mate.id, remote: false, home: mate.home } }
		};
	}

	/** The task's status log, read at most every STATUS_TTL_MS however many pages ask. */
	log(id: string): Promise<LogResult> {
		const f = this.find(id);
		if (!f.ok) return Promise.resolve({ ok: false, offline: false, reason: f.error });
		const hit = this.logs.get(id);
		const now = this.now();
		if (hit && now - hit.at < STATUS_TTL_MS) return hit.value;
		const value = this.readLog(f.value);
		this.logs.set(id, { at: now, value });
		for (const [k, v] of this.logs) if (now - v.at > STATUS_TTL_MS * 30) this.logs.delete(k);
		return value;
	}

	/**
	 * What the last reads of a task's status log and meta file said (null
	 * until either has been read).
	 */
	facts(id: string): {
		pr: string | null;
		preview: MateTaskLog['preview'];
		projectId: string | null;
		filesChanged: number | null;
	} | null {
		const k = this.known.get(id);
		const meta = this.metas.get(id)?.value ?? null;
		const count = this.counts.get(id);
		return k || meta || count !== undefined
			? {
					pr: k?.pr ?? meta?.pr ?? null,
					preview: k?.preview ?? null,
					projectId: meta?.projectId ?? null,
					filesChanged: count ?? null
				}
			: null;
	}

	/**
	 * The task's changed files, as a task of the captain's has them, from the
	 * worktree its meta file records: on this computer directly, on a remote
	 * second mate's host with read-only git over its SSH alias (remotegit.ts),
	 * uncommitted and untracked files included. Read at most every
	 * CHANGES_TTL_MS however many pages ask.
	 */
	async changes(id: string): Promise<Files> {
		return (await this.readChanges(id, CHANGES_TTL_MS)).files;
	}

	/**
	 * One changed file's unified diff, only for a path the task's list of
	 * changed files names, bounded as a task of the captain's is.
	 */
	async fileDiff(id: string, file: string): Promise<FileDiff> {
		const f = this.find(id);
		if (!f.ok) return { available: false, reason: f.error };
		if (!f.value.route.remote) {
			const wt = await this.worktreeOf(f.value);
			if (!wt.ok) return { available: false, reason: wt.reason };
			if (!this.deps.evidence) return { available: false, reason: WORKTREE_GONE };
			return this.deps.evidence.fileDiff(wt.path, file);
		}
		const read = await this.readChanges(id, CHANGES_TTL_MS);
		if (!read.files.available) return { available: false, reason: read.files.reason };
		const { base, mergeBase, files } = read.files.value;
		const entry = files.find((x) => x.path === file);
		if (!entry) {
			return { available: false, reason: 'That file is not in this task’s list of changed files.' };
		}
		const { mate } = f.value;
		if (!read.worktree || !mergeBase || !mate.host || !this.deps.remoteGit) {
			return { available: false, reason: 'git diff failed in the task worktree.' };
		}
		const key = `${id} ${mergeBase} ${entry.status} ${file}`;
		const now = this.now();
		const hit = this.fileDiffs.get(key);
		if (hit && now - hit.at < FILE_DIFF_TTL_MS) return hit.value;
		const value = this.deps.remoteGit
			.fileDiff(mate.host, read.worktree, mate.id, mergeBase, base, entry)
			.then((r) => r.diff)
			.catch((e): FileDiff => ({
				available: false,
				reason: `Its diff cannot be read: ${(e as Error).message}`
			}));
		this.fileDiffs.set(key, { at: now, value });
		for (const [k, v] of this.fileDiffs)
			if (now - v.at > FILE_DIFF_TTL_MS * 4) this.fileDiffs.delete(k);
		return value;
	}

	/** The task's changes, reusing a read younger than `maxAgeMs`. */
	private readChanges(id: string, maxAgeMs: number): Promise<ChangesRead> {
		const f = this.find(id);
		if (!f.ok) {
			return Promise.resolve({
				files: { available: false, reason: f.error },
				worktree: null,
				offline: false
			});
		}
		const hit = this.changeReads.get(id);
		const now = this.now();
		if (hit && now - hit.at < maxAgeMs) return hit.value;
		const value = this.readChangesOnce(f.value)
			.catch((e): ChangesRead => ({
				files: {
					available: false,
					reason: `Its changes cannot be read: ${(e as Error).message}`
				},
				worktree: null,
				offline: false
			}))
			.then((r) => {
				// A card in flight counts what the last read listed, as a live task of the
				// captain's does, and keeps that count while its host cannot be reached.
				const live = f.value.mate.inFlight.some((t) => t.id === f.value.task.id);
				if (live && !r.offline) {
					this.counts.set(id, r.files.available ? r.files.value.total : null);
				}
				return r;
			});
		this.changeReads.set(id, { at: now, value });
		for (const [k, v] of this.changeReads)
			if (now - v.at > CHANGES_TTL_MS * 4) this.changeReads.delete(k);
		return value;
	}

	private async readChangesOnce(found: Found): Promise<ChangesRead> {
		const { mate, task, route } = found;
		const off = (reason: string, offline = false): ChangesRead => ({
			files: { available: false, reason },
			worktree: null,
			offline
		});
		if (task.status === 'queued') return off('Work has not started.');
		if (!route.remote) {
			const wt = await this.worktreeOf(found);
			if (!wt.ok) return off(wt.reason);
			if (!this.deps.evidence) return off(WORKTREE_GONE);
			const files = await this.deps.evidence.diff(wt.path);
			return { files, worktree: wt.path, offline: false };
		}
		if (!mate.host) return off(`Firstmate records no SSH host for second mate ${mate.id}.`);
		if (!this.deps.remoteGit) return off('Wheelhouse cannot read a remote worktree here.');
		// The worktree is the one the task's meta in that home records.
		if ((await this.readMeta(found, false)) === 'offline') return off(OFFLINE(mate.host), true);
		const wt = this.metas.get(mateTaskId(mate.id, task.id))?.value?.worktree ?? null;
		if (!wt) return off(`Second mate ${mate.id} records no worktree for this task.`);
		const r = await this.deps.remoteGit.changes(mate.host, wt, mate.id);
		return { files: r.files, worktree: wt, offline: r.offline };
	}

	/** The worktree a local second mate's task meta records, when it is still there. */
	private async worktreeOf(
		found: Found
	): Promise<{ ok: true; path: string } | { ok: false; reason: string }> {
		if (found.task.status === 'queued') return { ok: false, reason: 'Work has not started.' };
		await this.readMeta(found, false);
		const wt = this.metas.get(mateTaskId(found.mate.id, found.task.id))?.value?.worktree ?? null;
		if (!wt || !path.isAbsolute(wt)) {
			return {
				ok: false,
				reason: `Second mate ${found.mate.id} records no worktree for this task.`
			};
		}
		const present = await stat(wt).then(
			(st) => st.isDirectory(),
			() => false
		);
		return present ? { ok: true, path: wt } : { ok: false, reason: WORKTREE_GONE };
	}

	/**
	 * Read the status logs of second mates' tasks in flight, a couple at a time
	 * and each at most every REFRESH_MS, so their cards carry their PR and
	 * preview; called as the fleet changes. One refresh runs at a time. Their
	 * changed-file counts are read apart, each on its own, which it starts but
	 * never waits for.
	 */
	async refresh(): Promise<void> {
		const ids = this.deps
			.mates()
			.filter((m) => m.health.online === 'online' || m.where === 'local')
			.flatMap((m) => m.inFlight.map((t) => mateTaskId(m.id, t.id)));
		this.refreshCounts(ids);
		if (this.refreshing) return;
		this.refreshing = true;
		try {
			const now = this.now();
			const due = ids.filter((id) => {
				const hit = this.logs.get(id);
				return !hit || now - hit.at >= REFRESH_MS;
			});
			for (let i = 0; i < due.length; i += REFRESH_AT_ONCE) {
				await Promise.all(due.slice(i, i + REFRESH_AT_ONCE).map((id) => this.readFresh(id)));
			}
		} finally {
			this.refreshing = false;
		}
	}

	/**
	 * Start the changed-file counts of tasks in flight, for their cards: each
	 * task's on its own, at most every REFRESH_MS and one at a time, so a slow
	 * host never holds up another task's count.
	 */
	private refreshCounts(ids: string[]): void {
		const now = this.now();
		for (const id of ids) {
			const at = this.countedAt.get(id);
			if (this.countsInFlight.has(id) || (at !== undefined && now - at < REFRESH_MS)) continue;
			this.countsInFlight.add(id);
			void this.readCount(id).finally(() => this.countsInFlight.delete(id));
		}
	}

	/**
	 * How many files a task changes, for its card: its list of changed files
	 * (numstat and untracked files only, never a file's diff), read in its
	 * worktree here or over its SSH alias. A card keeps its last count while
	 * its host cannot be reached, and loses it when the count cannot be read.
	 */
	private async readCount(id: string): Promise<void> {
		const f = this.find(id);
		if (!f.ok) return;
		this.countedAt.set(id, this.now());
		await this.readChanges(id, REFRESH_MS);
	}

	/** A read for refresh: as `log`, but not reusing a cached read younger than REFRESH_MS. */
	private readFresh(id: string): Promise<LogResult> {
		const f = this.find(id);
		if (!f.ok) return Promise.resolve({ ok: false, offline: false, reason: f.error });
		const value = this.readLog(f.value);
		this.logs.set(id, { at: this.now(), value });
		return value;
	}

	private async readLog(found: Found): Promise<LogResult> {
		const id = mateTaskId(found.mate.id, found.task.id);
		const [r, read] = await Promise.all([this.readLogOnce(found), this.readMeta(found, false)]);
		if (!r.ok) return r;
		if (r.value.cut) {
			// Past fm-remote-file.sh's bound its PR is the one its meta records, read again until it does.
			if (!read && !this.metas.get(id)?.value?.pr) await this.readMeta(found, true);
			const pr = this.metas.get(id)?.value?.pr ?? r.value.pr;
			const value = { ...r.value, pr };
			this.known.set(id, value);
			return { ...r, value };
		}
		this.known.set(id, r.value);
		return r;
	}

	/**
	 * The task's meta file, for its project and PR: read once, again after a
	 * failed read only once META_RETRY_MS have passed (at once after an
	 * offline one), and again when `again` and META_RETRY_MS have passed.
	 * Whether it was read.
	 */
	private async readMeta(
		{ mate, task, route }: Found,
		again: boolean
	): Promise<boolean | 'offline'> {
		const id = mateTaskId(mate.id, task.id);
		const hit = this.metas.get(id);
		const now = this.now();
		if (hit && (hit.value && !again ? true : now - hit.at < META_RETRY_MS)) return false;
		const rel = `state/${task.id}.meta`;
		let text: string | null;
		if (route.remote) {
			const r = await this.deps.adapter.remoteFile(mate.id, rel, META_MAX_BYTES);
			if (!r.ok && r.error.exitCode === REMOTE_UNREACHABLE) return 'offline';
			text = r.ok ? r.value : null;
		} else {
			text = (await readInside(route.home, rel, META_MAX_BYTES))?.text ?? null;
		}
		const value =
			text === null
				? (hit?.value ?? null)
				: {
						projectId: parseMetaProject(text, mate.home),
						pr: parseMetaPr(text),
						worktree: metaGet(text, 'worktree').trim() || null,
						branch: metaGet(text, 'branch').trim() || null
					};
		this.metas.set(id, { at: now, value });
		return true;
	}

	private async readLogOnce({ mate, task, route }: Found): Promise<LogResult> {
		const id = mateTaskId(mate.id, task.id);
		const rel = `state/${task.id}.status`;
		const observedAt = new Date(this.now()).toISOString();
		const log = ({ text, truncated }: { text: string; truncated: boolean }): MateTaskLog => ({
			...parseStatusLog(text),
			truncated
		});
		if (!route.remote) {
			const read = await readInside(route.home, rel, STATUS_MAX_BYTES);
			return read === null
				? { ok: false, offline: false, reason: 'Its status log cannot be read.' }
				: { ok: true, value: log(read), observedAt };
		}
		// fm-remote-file.sh sends a file whole or not at all, so a log past
		// STATUS_MAX_BYTES is fetched whole up to its bound and its tail kept here.
		const get = (max: number) => this.deps.adapter.remoteFile(mate.id, rel, max);
		let r = await get(this.large.has(id) ? REMOTE_FILE_MAX_BYTES : STATUS_MAX_BYTES);
		if (!r.ok && !this.large.has(id) && TOO_LARGE.test(r.error.message)) {
			this.large.add(id);
			r = await get(REMOTE_FILE_MAX_BYTES);
		}
		if (r.ok) {
			return {
				ok: true,
				value: log(tailText(Buffer.from(r.value, 'utf8'), STATUS_MAX_BYTES)),
				observedAt: r.observedAt
			};
		}
		if (r.error.exitCode === REMOTE_UNREACHABLE) {
			return { ok: false, offline: true, reason: OFFLINE(mate.host) };
		}
		if (TOO_LARGE.test(r.error.message)) {
			// Past even that bound: keep the PR and preview last read, and say the history is cut.
			const k = this.known.get(id);
			return {
				ok: true,
				value: {
					lines: [],
					preview: k?.preview ?? null,
					pr: k?.pr ?? null,
					truncated: true,
					cut: true
				},
				observedAt
			};
		}
		return {
			ok: false,
			offline: false,
			reason: `Its status log cannot be read: ${r.error.message}`
		};
	}

	/**
	 * The task's preview, checked as one of the captain's own is: for a remote
	 * second mate, at the end of a forward over its SSH alias.
	 */
	async preview(id: string, pageOrigin: string): Promise<PreviewCheck> {
		const checkedAt = new Date(this.now()).toISOString();
		const none = (reason: string, state: PreviewCheck['state'] = 'none'): PreviewCheck => ({
			url: null,
			reportedAt: null,
			state,
			reason,
			checkedAt
		});
		const f = this.find(id);
		if (!f.ok) return none(f.error);
		const log = await this.log(id);
		if (!log.ok) return none(log.reason, log.offline ? 'down' : 'none');
		const reported = log.value.preview && {
			url: log.value.preview.url,
			// A line without its time counts from when it was read.
			reportedAt: log.value.preview.reportedAt ?? log.observedAt
		};
		const landed = f.value.task.status === 'landed';
		if (!reported && log.value.cut) {
			return none(
				'Its status log has grown past the 1 MiB Firstmate sends, so the preview it reported cannot be read.',
				'none'
			);
		}
		if (!reported || !f.value.route.remote) {
			return this.deps.check(reported, pageOrigin, { landed });
		}
		const target = loopbackPreview(reported.url);
		if (!target.ok) return { ...none(target.reason, 'refused'), url: reported.url };
		const u = new URL(target.url);
		const port = Number(u.port || (u.protocol === 'https:' ? 443 : 80));
		const host = f.value.mate.host;
		if (!host) return none('Firstmate records no host for this second mate.');
		const fwd = await this.deps.forwards.open(host, port);
		if (!fwd.ok) return { ...none(fwd.reason, fwd.offline ? 'down' : 'refused') };
		this.opened.set(id, forwardKey(host, port));
		u.hostname = '127.0.0.1';
		u.port = String(fwd.port);
		return this.deps.check({ url: u.href, reportedAt: reported.reportedAt }, pageOrigin, {
			landed
		});
	}

	/** A bounded, read-only look at the task's console in its second mate's home. */
	output(id: string, asked: number): Promise<TaskOutput> {
		const lines = Math.min(
			PEEK_MAX_LINES,
			Math.max(1, Number.isFinite(asked) ? Math.floor(asked) : PEEK_DEFAULT_LINES)
		);
		const off = (reason: string): TaskOutput => ({
			available: false,
			reason,
			lines: [],
			capturedAt: null,
			requested: lines
		});
		const f = this.find(id);
		if (!f.ok) return Promise.resolve(off(f.error));
		const busy = this.looks.get(id);
		if (busy) return busy;
		const { mate, task, route } = f.value;
		// A card's console asks every few seconds; a remote look is an SSH call, so a recent one is shared.
		const seen = this.seen.get(id);
		const now = this.now();
		if (seen && now - seen.at < (route.remote ? REMOTE_LOOK_MS : 0))
			return Promise.resolve(seen.value);
		const look = this.deps.adapter
			.matePeekTask(route, task.id, lines)
			.then((r): TaskOutput => {
				if (r.ok) {
					return {
						available: true,
						reason: null,
						lines: r.value.lines,
						capturedAt: r.observedAt,
						requested: lines
					};
				}
				return off(
					route.remote && r.error.exitCode === REMOTE_UNREACHABLE
						? OFFLINE(mate.host)
						: `Could not read the worker’s terminal: ${r.error.message}`
				);
			})
			.then((v) => {
				this.seen.set(id, { at: this.now(), value: v });
				return v;
			})
			.finally(() => this.looks.delete(id));
		this.looks.set(id, look);
		return look;
	}

	/**
	 * Feedback about the task, to its own second mate: one note in that second
	 * mate's inbox, `Re: <task>` as Wheelhouse's own notes are, with the task's
	 * `<task>@<mate>` name in the text put back to the id that home knows it by.
	 */
	async send(
		id: string,
		requestId: string,
		text: string
	): Promise<
		| { ok: true; created: boolean; announced: boolean | null }
		| { ok: false; status: 400 | 404 | 409 | 502 | 504; error: string }
	> {
		const f = this.find(id);
		if (!f.ok) return f;
		const { mate, task, route } = f.value;
		const body = `Re: ${task.id}\n${text.split(mateTaskId(mate.id, task.id)).join(task.id)}`;
		const r: AdapterResult<{ outcome: string; announced: boolean | null }> =
			await this.deps.adapter.mateNote(route, requestId, body);
		if (r.ok)
			return { ok: true, created: r.value.outcome === 'created', announced: r.value.announced };
		if (r.error.kind === 'invalid-argument')
			return { ok: false, status: 400, error: r.error.message };
		if (route.remote && r.error.exitCode === REMOTE_UNREACHABLE) {
			return {
				ok: false,
				status: 502,
				error: `Could not reach ${mate.host ?? 'its host'}, so ${mate.id} may not have it. Wheelhouse did not send it again.`
			};
		}
		return {
			ok: false,
			status: r.error.kind === 'timeout' ? 504 : 502,
			error: `${mate.id} did not take it: ${r.error.message}`
		};
	}

	/** What the preview helper is told about the task (server/previewhelper.ts). */
	async helperContext(id: string): Promise<
		| {
				ok: true;
				task: { id: string; title: string; project: string; status: string };
				preview: string;
				history: string[];
		  }
		| { ok: false; status: 404 | 409; error: string }
	> {
		const f = this.find(id);
		if (!f.ok) return f;
		const check = await this.preview(id, 'http://127.0.0.1');
		if (!check.url)
			return { ok: false, status: 409, error: 'This task has no preview to talk about.' };
		const log = await this.log(id);
		const { mate, task } = f.value;
		return {
			ok: true,
			task: {
				id: task.id,
				title: task.title,
				project: task.projectId ?? this.metas.get(id)?.value?.projectId ?? `second mate ${mate.id}`,
				status: task.status
			},
			preview: check.url,
			history: log.ok
				? log.value.lines
						.slice(-30)
						.map((l) =>
							`${(l.at ?? '').slice(0, 16).replace('T', ' ')} ${plainStatus(l.state, l.text)}`.trim()
						)
				: []
		};
	}

	/**
	 * Close the forwards of previews whose tasks are no longer in flight (landed,
	 * or gone from their second mate's work), and forget the meta files of tasks
	 * their second mates no longer list; called as the fleet changes.
	 */
	retain(): void {
		const live = new Set<string>();
		const listed = new Set<string>();
		for (const m of this.deps.mates()) {
			for (const t of m.inFlight) live.add(mateTaskId(m.id, t.id));
			for (const t of tasksOf(m)) listed.add(mateTaskId(m.id, t.id));
		}
		for (const id of [...this.metas.keys()]) if (!listed.has(id)) this.metas.delete(id);
		for (const id of [...this.large]) if (!live.has(id)) this.large.delete(id);
		for (const id of [...this.opened.keys()]) if (!live.has(id)) this.opened.delete(id);
		for (const id of [...this.known.keys()]) if (!live.has(id)) this.known.delete(id);
		for (const id of [...this.counts.keys()]) if (!live.has(id)) this.counts.delete(id);
		for (const id of [...this.countedAt.keys()]) if (!live.has(id)) this.countedAt.delete(id);
		for (const id of [...this.changeReads.keys()]) if (!listed.has(id)) this.changeReads.delete(id);
		for (const id of [...this.seen.keys()]) if (!live.has(id)) this.seen.delete(id);
		this.deps.forwards.retain(new Set(this.opened.values()));
	}
}

/** A file under `root` (symlinks resolved, never leaving it), at most `max` bytes from its end. */
async function readInside(
	root: string,
	rel: string,
	max: number
): Promise<{ text: string; truncated: boolean } | null> {
	try {
		const base = await realpath(root);
		const file = await realpath(path.resolve(base, rel));
		if (!file.startsWith(base + path.sep)) return null;
		const fh = await open(file, 'r');
		try {
			const { size } = await fh.stat();
			const start = Math.max(0, size - max);
			const buf = Buffer.alloc(Math.min(size, max));
			const { bytesRead } = await fh.read(buf, 0, buf.length, start);
			const text = buf.subarray(0, bytesRead).toString('utf8');
			// A tail read starts mid-line: drop that partial first line.
			return start > 0
				? { text: text.slice(text.indexOf('\n') + 1), truncated: true }
				: { text, truncated: false };
		} finally {
			await fh.close();
		}
	} catch {
		return null;
	}
}
