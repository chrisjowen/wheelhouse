import type { TaskSummary } from '$lib/types';

/**
 * How the Harbour dashboard sorts the fleet into its sections. Pure, so it is
 * unit-tested alongside the server rules.
 */

export const LANDED_RECENT_MS = 24 * 3600 * 1000;

export interface Harbour {
	/** Waiting on the captain: captain holds and PRs awaiting review. */
	needsYou: TaskSummary[];
	/** Decisions a worker raised that Firstmate is handling. */
	waitingOnFirstmate: TaskSummary[];
	underWay: TaskSummary[];
	queued: TaskSummary[];
	landedRecent: TaskSummary[];
	landedOlder: TaskSummary[];
	/** Under-way work that is blocked, failed, out of contact or unreadable. */
	trouble: TaskSummary[];
}

const TROUBLE = new Set(['blocked', 'failed', 'lost', 'unknown']);

export const isTrouble = (t: TaskSummary) => TROUBLE.has(t.status);
export const needsYou = (t: TaskSummary) => t.attention?.owner === 'captain';

/** When a landed task landed, as epoch ms (exact from the ledger, else end of its day). */
export function landedAt(t: TaskSummary): number | null {
	if (t.mergedAt) return Date.parse(t.mergedAt);
	if (t.completedOn) {
		const d = Date.parse(`${t.completedOn}T23:59:59`);
		return Number.isNaN(d) ? null : d;
	}
	return null;
}

const STATUS_ORDER: Record<string, number> = {
	blocked: 0,
	failed: 0,
	lost: 1,
	unknown: 1,
	waiting: 2,
	done: 3,
	working: 4
};

/** How far along a task is, 0..1, from its own passage. */
export const progress = (t: TaskSummary) =>
	t.passage.steps.length > 1 ? t.passage.current / (t.passage.steps.length - 1) : 0;

export interface ChartColumn {
	key: string;
	label: string;
}

/**
 * Chart columns for a set of tasks: the ordered union of their steps' column
 * keys, so new step keys from other stage models line up without code changes.
 */
export function chartColumns(tasks: TaskSummary[]): ChartColumn[] {
	const order: string[] = [];
	const labels = new Map<string, { label: string; own: boolean }>();
	for (const t of tasks) {
		let after = -1;
		for (const s of t.passage.steps) {
			let at = order.indexOf(s.column);
			if (at < 0) {
				order.splice(after + 1, 0, s.column);
				at = after + 1;
			}
			after = at;
			const own = s.key === s.column;
			const prev = labels.get(s.column);
			if (!prev || (own && !prev.own)) labels.set(s.column, { label: s.label, own });
		}
	}
	return order.map((key) => ({ key, label: labels.get(key)?.label ?? key }));
}

export function harbour(tasks: TaskSummary[], now: number): Harbour {
	const h: Harbour = {
		needsYou: [],
		waitingOnFirstmate: [],
		underWay: [],
		queued: [],
		landedRecent: [],
		landedOlder: [],
		trouble: []
	};
	for (const t of tasks) {
		if (needsYou(t)) h.needsYou.push(t);
		else if (t.status === 'with-firstmate') h.waitingOnFirstmate.push(t);
		else if (t.status === 'queued') h.queued.push(t);
		else if (t.status === 'landed') {
			const at = landedAt(t);
			(at !== null && now - at <= LANDED_RECENT_MS ? h.landedRecent : h.landedOlder).push(t);
		} else {
			h.underWay.push(t);
			if (isTrouble(t)) h.trouble.push(t);
		}
	}
	h.underWay.sort(
		(a, b) =>
			(STATUS_ORDER[a.status] ?? 5) - (STATUS_ORDER[b.status] ?? 5) || progress(b) - progress(a)
	);
	const byLanded = (a: TaskSummary, b: TaskSummary) => (landedAt(b) ?? 0) - (landedAt(a) ?? 0);
	h.landedRecent.sort(byLanded);
	h.landedOlder.sort(byLanded);
	return h;
}

/** The watch report's headline sentence. */
export function headline(h: Harbour): string {
	const parts: string[] = [];
	const n = h.needsYou.length;
	parts.push(
		n === 0 ? 'Nothing needs you.' : `${n} ${n === 1 ? 'thing needs' : 'things need'} you.`
	);
	parts.push(`${h.landedRecent.length} landed in the last day.`);
	const extra: string[] = [];
	if (h.waitingOnFirstmate.length)
		extra.push(`${h.waitingOnFirstmate.length} waiting on Firstmate`);
	if (h.trouble.length) extra.push(`${h.trouble.length} with Firstmate keeping an eye on them`);
	parts.push(`${h.underWay.length} under way${extra.length ? `, ${extra.join(', ')}` : ''}.`);
	return parts.join(' ');
}
