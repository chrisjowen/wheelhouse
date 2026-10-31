import { completedAt, isCompleted, isTrouble, landedAt, needsYou, progress } from '$lib/harbour';
import type { Project, TaskSummary } from '$lib/types';

/**
 * How a project's work is laid out, and the task list's sorting. Pure, so it is
 * unit-tested; the chosen layout is remembered in a cookie (see VIEW_COOKIE).
 */

/** A project's work: large cards (pictures and the full story), compact cards, or one row per task. */
export type BoardView = 'large' | 'compact' | 'list';
export const BOARD_VIEWS: readonly BoardView[] = ['large', 'compact', 'list'];

/** The cookie the work's layout is remembered in. */
export const VIEW_COOKIE = { harbour: 'wh-harbour-view' } as const;

/** A remembered layout, or the page's first one when it is absent or unknown. */
export function viewOf<T extends string>(value: string | null | undefined, views: readonly T[]): T {
	return views.includes(value as T) ? (value as T) : views[0];
}

export type SortDir = 'asc' | 'desc';
export interface Sort<K extends string> {
	key: K;
	dir: SortDir;
}

/** The sort a column header click gives: the same column flips, a new column starts at its natural direction. */
export function nextSort<K extends string>(sort: Sort<K>, key: K, firstDir: SortDir): Sort<K> {
	return sort.key === key
		? { key, dir: sort.dir === 'asc' ? 'desc' : 'asc' }
		: { key, dir: firstDir };
}

const ms = (iso: string | null | undefined) => {
	const t = iso ? Date.parse(iso) : NaN;
	return Number.isNaN(t) ? null : t;
};

/**
 * When anything last happened on a task, as epoch ms (null when nothing says): its
 * latest reported activity, when it landed, or when it started. Firstmate's crew-state
 * read is left out; it is re-read every poll, so it is always "just now".
 */
export function updatedAt(t: TaskSummary): number | null {
	const times = [ms(t.activity?.at), landedAt(t), ms(t.since)].filter(
		(x): x is number => x !== null
	);
	return times.length ? Math.max(...times) : null;
}

/**
 * Who a task is waiting on, in a word or two: you (a review or decision), Firstmate
 * (a raised decision, or trouble it is keeping an eye on), reviewers (other people's
 * review of its pull request), the crew (work under way), earlier tasks (queued
 * behind them), or nobody (finished).
 */
export type WaitingOn = 'you' | 'firstmate' | 'reviewers' | 'crew' | 'queue' | 'nobody';

export function waitingOn(t: TaskSummary): { who: WaitingOn; label: string } {
	if (needsYou(t))
		return {
			who: 'you',
			label:
				t.attention?.kind !== 'review'
					? 'You: decision'
					: t.attention.approved
						? 'You: merge'
						: 'You: review'
		};
	if (t.status === 'with-firstmate' || isTrouble(t))
		return { who: 'firstmate', label: 'Firstmate' };
	if (t.status === 'with-reviewers') return { who: 'reviewers', label: 'Reviewers' };
	if (isCompleted(t)) return { who: 'nobody', label: '—' };
	if (t.status === 'queued')
		return {
			who: 'queue',
			label: t.blockedBy.length
				? `${t.blockedBy.length} earlier ${t.blockedBy.length === 1 ? 'task' : 'tasks'}`
				: 'Its turn'
		};
	return { who: 'crew', label: 'Crew' };
}

const WAITING_ORDER: Record<WaitingOn, number> = {
	you: 0,
	firstmate: 1,
	reviewers: 2,
	crew: 3,
	queue: 4,
	nobody: 5
};

// Status reads from most to least pressing: yours, trouble, Firstmate's, working, queued, finished.
const STATUS_ORDER: Record<string, number> = {
	'needs-review': 0,
	'needs-decision': 0,
	blocked: 1,
	failed: 1,
	lost: 2,
	unknown: 2,
	'with-firstmate': 3,
	'with-reviewers': 3,
	waiting: 4,
	working: 5,
	queued: 6,
	done: 7,
	landed: 8
};
const statusRank = (t: TaskSummary) => (needsYou(t) ? 0 : (STATUS_ORDER[t.status] ?? 5));

export type TaskColumn = 'task' | 'project' | 'stage' | 'status' | 'waiting' | 'updated';

/** Each column's first direction: names A–Z, stage furthest along first, most pressing first, newest first. */
export const TASK_FIRST_DIR: Record<TaskColumn, SortDir> = {
	task: 'asc',
	project: 'asc',
	stage: 'desc',
	status: 'asc',
	waiting: 'asc',
	updated: 'desc'
};

/** The list view's rows in a column's order; ties keep the most pressing and newest first. */
export function sortTasks(
	tasks: TaskSummary[],
	sort: Sort<TaskColumn>,
	projectName: (t: TaskSummary) => string
): TaskSummary[] {
	const text = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base' });
	const when = (t: TaskSummary) => (isCompleted(t) ? completedAt(t) : updatedAt(t)) ?? 0;
	const by: Record<TaskColumn, (a: TaskSummary, b: TaskSummary) => number> = {
		task: (a, b) => text(a.shortTitle, b.shortTitle),
		project: (a, b) => text(projectName(a), projectName(b)),
		stage: (a, b) => progress(a) - progress(b) || a.passage.current - b.passage.current,
		status: (a, b) => statusRank(a) - statusRank(b),
		waiting: (a, b) => WAITING_ORDER[waitingOn(a).who] - WAITING_ORDER[waitingOn(b).who],
		updated: (a, b) => when(a) - when(b)
	};
	const sign = sort.dir === 'asc' ? 1 : -1;
	return tasks.toSorted(
		(a, b) => sign * by[sort.key](a, b) || statusRank(a) - statusRank(b) || when(b) - when(a)
	);
}

/** "Landed this week" on a project's card and page, and in the project switcher: the last week. */
export const PROJECT_LANDED_MS = 7 * 24 * 3600 * 1000;

export interface ProjectStats {
	/** Work under way, including what is with Firstmate (not what needs you). */
	underWay: number;
	/** Waiting on the captain: reviews and decisions. */
	needsYou: number;
	/** Landed in the last week. */
	landed: number;
	queued: number;
	/** When anything last happened in the project, as epoch ms. */
	lastActivity: number | null;
}

export function projectStats(tasks: TaskSummary[], now: number): ProjectStats {
	const s: ProjectStats = { underWay: 0, needsYou: 0, landed: 0, queued: 0, lastActivity: null };
	for (const t of tasks) {
		if (needsYou(t)) s.needsYou++;
		else if (t.status === 'queued') s.queued++;
		else if (isCompleted(t)) {
			const at = completedAt(t);
			if (t.status === 'landed' && at !== null && now - at <= PROJECT_LANDED_MS) s.landed++;
		} else s.underWay++;
		const at = isCompleted(t) ? completedAt(t) : updatedAt(t);
		if (at !== null && (s.lastActivity === null || at > s.lastActivity)) s.lastActivity = at;
	}
	return s;
}

/**
 * A project's delivery posture in plain words: how a change ships, and who merges it.
 * A registered project with no bracket is a legacy entry and ships through the full
 * checks; an unregistered one has no posture.
 */
export function postureWords(
	p: Pick<Project, 'posture' | 'registered'>
): { ships: string; merges: string; short: string } | null {
	if (!p.registered) return null;
	const tokens = (p.posture ?? '').split(/\s+/).filter(Boolean);
	const mode = tokens.find((x) => !x.startsWith('+') && !x.includes('=')) ?? 'no-mistakes';
	const gerrit = tokens.includes('forge=gerrit') ? ' on Gerrit' : '';
	const SHIPS: Record<string, string> = {
		'no-mistakes': `Every change runs the full checks before its pull request${gerrit}`,
		'direct-PR': `Changes go straight to a pull request${gerrit}`,
		'local-only': 'Kept on this machine: changes land locally, with no pull request',
		'no-mistakes-prod-only': `Product changes run the full checks; internal tooling goes straight to a pull request${gerrit}`
	};
	const SHORT: Record<string, string> = {
		'no-mistakes': 'Full checks',
		'direct-PR': 'Straight to PR',
		'local-only': 'Local only',
		'no-mistakes-prod-only': 'Full checks for product work'
	};
	const yolo = mode !== 'local-only' && tokens.includes('+yolo');
	return {
		ships: SHIPS[mode] ?? `Ships as "${mode}"`,
		merges:
			mode === 'local-only'
				? 'You approve each landing'
				: yolo
					? 'Firstmate merges once checks are green'
					: 'You merge each pull request',
		short: `${SHORT[mode] ?? mode} · ${mode === 'local-only' ? 'you approve' : yolo ? 'Firstmate merges' : 'you merge'}`
	};
}
