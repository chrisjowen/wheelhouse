import { harbour, railUnderWay } from './harbour';
import { escalated, answered, visibleCards, type InboxCard, type Snoozed } from './inbox';
import type { TaskDetail, TaskSummary } from './types';

/**
 * The calls the captain owes, and the rules every place that shows them keeps
 * (On deck, the chat, Decisions and Live mode): each call is drawn in full in
 * one place; a new one joins the end of the line and never takes the place of
 * the one being read; one counts as seen only once it has been on screen for a
 * moment; one that clears itself while the captain was looking at it stays,
 * saying so, until they put it away; and routine progress is a single calm
 * line, never a card. Pure, so it is unit-tested; lib/client/calls.svelte.ts
 * keeps the browser's part (what was seen).
 */

/** How long a call must be on screen before it counts as seen. */
export const SEEN_AFTER_MS = 1000;
/** Seen marks older than this are forgotten. */
export const SEEN_KEEP_MS = 14 * 24 * 3600 * 1000;
export const SEEN_KEY = 'wheelhouse-seen-calls';

/** When a call was asked, as a number, or null when it is not known. */
const askedAt = (c: Pick<InboxCard, 'askedAt'>) => {
	const t = c.askedAt ? Date.parse(c.askedAt) : NaN;
	return Number.isNaN(t) ? null : t;
};

/** Oldest first, so a new call joins the end; one with no time asked goes last. */
export function inArrivalOrder<T extends Pick<InboxCard, 'askedAt' | 'id'>>(cards: T[]): T[] {
	return [...cards].sort((a, b) => {
		const x = askedAt(a);
		const y = askedAt(b);
		if (x === null || y === null) return x === y ? a.id.localeCompare(b.id) : x === null ? 1 : -1;
		return x - y || a.id.localeCompare(b.id);
	});
}

/**
 * The calls waiting on the captain, in the order they arrived: what Firstmate
 * escalated, not answered yet, not being talked through in the chat, and not
 * put off for later in this browser.
 */
export function waitingCalls(cards: InboxCard[], snoozed: Snoozed, now: number): InboxCard[] {
	const open = cards.filter((c) => escalated(c) && !c.following && !answered(c));
	return inArrivalOrder(visibleCards(open, snoozed, now).shown);
}

/** A call's seen mark: the same question asked again later is a new call. */
export const seenKey = (c: Pick<InboxCard, 'id' | 'askedAt'>) => `${c.id}@${c.askedAt ?? ''}`;

export type Seen = Record<string, number>;

/** The seen marks kept in this browser, without those too old to matter. */
export function parseSeen(raw: string | null, now: number): Seen {
	if (!raw) return {};
	try {
		const v = JSON.parse(raw) as unknown;
		if (typeof v !== 'object' || v === null || Array.isArray(v)) return {};
		const out: Seen = {};
		for (const [k, at] of Object.entries(v))
			if (typeof at === 'number' && now - at < SEEN_KEEP_MS) out[k] = at;
		return out;
	} catch {
		return {};
	}
}

export const isSeen = (seen: Seen, c: Pick<InboxCard, 'id' | 'askedAt'>) => seenKey(c) in seen;

/**
 * Which call is in front: the one being read while it still waits (a new call
 * never takes its place), else the first not seen yet, else the first.
 */
export function inFront(
	calls: Pick<InboxCard, 'id' | 'askedAt'>[],
	current: string | null,
	seen: Seen
): string | null {
	if (current && calls.some((c) => c.id === current)) return current;
	return (calls.find((c) => !isSeen(seen, c)) ?? calls[0])?.id ?? null;
}

/** The call after `from` once it is answered: the first not seen yet, else the next in line. */
export function nextAfter(
	calls: Pick<InboxCard, 'id' | 'askedAt'>[],
	from: string,
	seen: Seen
): string | null {
	const rest = calls.filter((c) => c.id !== from);
	const unseen = rest.find((c) => !isSeen(seen, c));
	if (unseen) return unseen.id;
	const i = calls.findIndex((c) => c.id === from);
	return (calls[i + 1] ?? calls[i - 1] ?? null)?.id ?? null;
}

/** A call that was on screen and has gone without an answer from the captain. */
export interface ClearedCall {
	card: InboxCard;
	/** When Wheelhouse saw it go. */
	at: string;
}

/**
 * The calls the captain saw that have left the inbox without their answer:
 * they cleared themselves (Firstmate settled them, or the work moved on). A
 * call answered here (`answeredHere`), one whose answer the inbox's log
 * records, or one that had an answer on its way is not one of them. `before`
 * is the calls as they last stood, `after` as they stand now.
 */
export function clearedCalls(
	before: InboxCard[],
	after: InboxCard[],
	seen: Seen,
	answeredHere: (id: string) => boolean,
	answeredLog: Set<string>
): { seen: InboxCard[]; unseen: InboxCard[] } {
	const still = new Set(after.map((c) => c.id));
	const gone = before.filter(
		(c) => !still.has(c.id) && !answeredHere(c.id) && !answeredLog.has(c.id) && !answered(c)
	);
	return {
		seen: gone.filter((c) => isSeen(seen, c)),
		unseen: gone.filter((c) => !isSeen(seen, c))
	};
}

/* ------------------------------------------------------------ the calm line */

export interface CalmEntry {
	taskId: string;
	task: string;
	projectId: string;
	text: string;
	at: string;
}

export interface Calm {
	underWay: number;
	landedToday: number;
	/** The latest thing that moved, if anything has. */
	latest: CalmEntry | null;
	/** What moved lately, oldest first, at most `limit`. */
	log: CalmEntry[];
}

const sameDay = (a: number, b: number) => new Date(a).toDateString() === new Date(b).toDateString();

/**
 * Progress as one calm line: how much is under way, what landed today, and the
 * latest thing that moved (a task's latest report), with a short log of what
 * moved before it. Never a card.
 */
export function calmOf(tasks: TaskSummary[], now: number, limit = 8): Calm {
	const h = harbour(tasks, now);
	const landedToday = h.landedRecent.filter((t) => {
		const at = t.mergedAt ? Date.parse(t.mergedAt) : NaN;
		return Number.isNaN(at) ? true : sameDay(at, now);
	});
	const moving = [...railUnderWay(h), ...h.needsYou, ...h.waitingOnFirstmate, ...h.landedRecent];
	const seen = new Set<string>();
	const entries: CalmEntry[] = [];
	for (const t of moving) {
		if (seen.has(t.id)) continue;
		seen.add(t.id);
		const at = t.status === 'landed' ? (t.mergedAt ?? t.activity?.at) : t.activity?.at;
		const text = t.status === 'landed' ? 'Landed' : t.activity?.text;
		if (!at || !text || Number.isNaN(Date.parse(at))) continue;
		entries.push({ taskId: t.id, task: t.shortTitle, projectId: t.projectId, text, at });
	}
	entries.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
	const log = entries.slice(-limit);
	return {
		underWay: railUnderWay(h).length,
		landedToday: landedToday.length,
		latest: log[log.length - 1] ?? null,
		log
	};
}

/* ------------------------------------------------------- the merge evidence */

export interface MergeFacts {
	additions: number | null;
	deletions: number | null;
	files: number | null;
	/** The biggest changes, by lines touched. */
	biggest: { path: string; additions: number; deletions: number }[];
	checks: { passed: number; total: number; failing: number; running: number } | null;
	/** Pictures named before and after, when the worker took them. */
	before: { name: string; url: string } | null;
	after: { name: string; url: string } | null;
	/** Other pictures, newest first, when there is no before and after. */
	shots: { name: string; url: string }[];
	/** A recording (an animated picture), when the worker made one. Never required. */
	recording: { name: string; url: string } | null;
	/** What the captain asked for, from the task's brief. */
	why: string | null;
}

const BEFORE = /(^|[^a-z])before([^a-z]|$)/i;
const AFTER = /(^|[^a-z])after([^a-z]|$)/i;
const RECORDING = /\.gif$/i;

/** First paragraph of what the captain asked, in one short block. */
function intentOf(text: string | null): string | null {
	const t = text
		?.split(/\n\s*\n/)
		.map((p) => p.replace(/\s+/g, ' ').trim())
		.find((p) => p && !p.startsWith('('));
	if (!t) return null;
	return t.length > 360 ? `${t.slice(0, 359).trimEnd()}…` : t;
}

/** What a merge call rests on, read from its task's own record (/api/tasks/<id>). */
export function mergeFacts(detail: Pick<TaskDetail, 'evidence' | 'brief'> | null): MergeFacts {
	const ev = detail?.evidence;
	const files = ev?.files.available ? ev.files.value : null;
	const known = files?.files.filter((f) => f.additions !== null || f.deletions !== null) ?? [];
	const sum = (k: 'additions' | 'deletions') =>
		known.length ? known.reduce((n, f) => n + (f[k] ?? 0), 0) : null;
	const pr = ev?.pr.available ? ev.pr.value : null;
	const counted = pr?.checks.filter((c) => c.state !== 'skipped') ?? [];
	const shotsAll = ev?.screenshots.available
		? [...ev.screenshots.value].sort((a, b) => Date.parse(b.modifiedAt) - Date.parse(a.modifiedAt))
		: [];
	const stills = shotsAll.filter((s) => !RECORDING.test(s.name));
	const pick = (re: RegExp) => {
		const s = stills.find((x) => re.test(x.name.replace(/\.[^.]+$/, '')));
		return s ? { name: s.name, url: s.url } : null;
	};
	const before = pick(BEFORE);
	const after = pick(AFTER);
	const rec = shotsAll.find((s) => RECORDING.test(s.name));
	return {
		additions: sum('additions'),
		deletions: sum('deletions'),
		files: files ? files.total : null,
		biggest: [...known]
			.sort(
				(a, b) =>
					(b.additions ?? 0) + (b.deletions ?? 0) - ((a.additions ?? 0) + (a.deletions ?? 0))
			)
			.slice(0, 3)
			.map((f) => ({ path: f.path, additions: f.additions ?? 0, deletions: f.deletions ?? 0 })),
		checks: counted.length
			? {
					passed: counted.filter((c) => c.state === 'pass').length,
					total: counted.length,
					failing: counted.filter((c) => c.state === 'fail').length,
					running: counted.filter((c) => c.state === 'running' || c.state === 'pending').length
				}
			: null,
		before: before && after ? before : null,
		after: before && after ? after : null,
		shots: before && after ? [] : stills.slice(0, 2).map((s) => ({ name: s.name, url: s.url })),
		recording: rec ? { name: rec.name, url: rec.url } : null,
		why: detail?.brief.available ? intentOf(detail.brief.value.intent) : null
	};
}

/** The review's points on the task's latest validation run: how many it raised, and fixed. */
export function reviewPoints(t: Pick<TaskSummary, 'pipeline'> | null | undefined) {
	const step = t?.pipeline?.steps.find((s) => s.key === 'review');
	if (!step || step.state === 'upcoming' || step.state === 'skipped') return null;
	return { raised: step.findings, fixed: step.fixes };
}
