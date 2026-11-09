import { open, realpath } from 'node:fs/promises';
import path from 'node:path';
import { loopbackPreview, type PreviewCheck } from '../../preview';
import { plainStatus } from '../../plain';
import type { MateTask, SecondMate, TaskOutput } from '../../types';
import {
	PEEK_DEFAULT_LINES,
	PEEK_MAX_LINES,
	REMOTE_UNREACHABLE,
	TASK_ID,
	type AdapterResult,
	type FirstmateAdapter,
	type MateRoute
} from './adapter';
import { forwardKey, type PreviewForwards } from './forwards';

/**
 * A task in a second mate's home, as Wheelhouse shows a task of its own: its
 * status history, pull request and preview from the task's status log in that
 * home (`state/<task>.status`, read-only: a local second mate's file directly,
 * a remote one's with `fm-on.sh <mate> fm-remote-file.sh get`), its console
 * (`fm-peek.sh` in that home, over fm-on.sh for a remote one), and its live
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

/** The largest status log read. */
export const STATUS_MAX_BYTES = 256 * 1024;
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
	return { lines, preview, pr };
}

type Found = { mate: SecondMate; task: MateTask; route: MateRoute };

export type MateLookup =
	{ ok: true; value: Found } | { ok: false; status: 404 | 409; error: string };

export type LogResult =
	| { ok: true; value: MateTaskLog; observedAt: string }
	| { ok: false; offline: boolean; reason: string };

export interface MateTasksDeps {
	adapter: Pick<FirstmateAdapter, 'remoteFile' | 'matePeekTask' | 'mateNote'>;
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
	private refreshing = false;
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

	/** What the last read of a task's status log said (null until one has been read). */
	facts(id: string): { pr: string | null; preview: MateTaskLog['preview'] } | null {
		const k = this.known.get(id);
		return k ? { pr: k.pr, preview: k.preview } : null;
	}

	/**
	 * Read the status logs of second mates' tasks in flight, a couple at a time
	 * and each at most every REFRESH_MS, so their cards carry their PR and
	 * preview; called as the fleet changes. One refresh runs at a time.
	 */
	async refresh(): Promise<void> {
		if (this.refreshing) return;
		this.refreshing = true;
		try {
			const ids = this.deps
				.mates()
				.filter((m) => m.health.online === 'online' || m.where === 'local')
				.flatMap((m) => m.inFlight.map((t) => mateTaskId(m.id, t.id)));
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

	/** A read for refresh: as `log`, but not reusing a cached read younger than REFRESH_MS. */
	private readFresh(id: string): Promise<LogResult> {
		const f = this.find(id);
		if (!f.ok) return Promise.resolve({ ok: false, offline: false, reason: f.error });
		const value = this.readLog(f.value);
		this.logs.set(id, { at: this.now(), value });
		return value;
	}

	private async readLog(found: Found): Promise<LogResult> {
		const r = await this.readLogOnce(found);
		if (r.ok) this.known.set(mateTaskId(found.mate.id, found.task.id), r.value);
		return r;
	}

	private async readLogOnce({ mate, task, route }: Found): Promise<LogResult> {
		const rel = `state/${task.id}.status`;
		const observedAt = new Date(this.now()).toISOString();
		if (!route.remote) {
			const text = await readInside(route.home, rel, STATUS_MAX_BYTES);
			return text === null
				? { ok: false, offline: false, reason: 'Its status log cannot be read.' }
				: { ok: true, value: parseStatusLog(text), observedAt };
		}
		const r = await this.deps.adapter.remoteFile(mate.id, rel, STATUS_MAX_BYTES);
		if (r.ok) return { ok: true, value: parseStatusLog(r.value), observedAt: r.observedAt };
		if (r.error.exitCode === REMOTE_UNREACHABLE) {
			return { ok: false, offline: true, reason: OFFLINE(mate.host) };
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
				project: task.projectId ?? `second mate ${mate.id}`,
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
	 * or gone from their second mate's work); called as the fleet changes.
	 */
	retain(): void {
		const live = new Set<string>();
		for (const m of this.deps.mates()) {
			for (const t of m.inFlight) live.add(mateTaskId(m.id, t.id));
		}
		for (const id of [...this.opened.keys()]) if (!live.has(id)) this.opened.delete(id);
		for (const id of [...this.known.keys()]) if (!live.has(id)) this.known.delete(id);
		for (const id of [...this.seen.keys()]) if (!live.has(id)) this.seen.delete(id);
		this.deps.forwards.retain(new Set(this.opened.values()));
	}
}

/** A file under `root` (symlinks resolved, never leaving it), at most `max` bytes from its end. */
async function readInside(root: string, rel: string, max: number): Promise<string | null> {
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
			let text = buf.subarray(0, bytesRead).toString('utf8');
			// A tail read starts mid-line: drop that partial first line.
			if (start > 0) text = text.slice(text.indexOf('\n') + 1);
			return text;
		} finally {
			await fh.close();
		}
	} catch {
		return null;
	}
}
