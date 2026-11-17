/** Display helpers for the insights pages: time splits, estimates and decisions. */

import type {
	DecisionsView,
	DecisionView,
	TimeSegment,
	TimeSplit,
	Verdict,
	WorkEta
} from './types';

export const SEGMENTS: { key: TimeSegment; label: string; hint: string }[] = [
	{ key: 'build', label: 'Building', hint: 'The worker writing and testing the change' },
	{
		key: 'review',
		label: 'Automated review and fixes',
		hint: 'Review, tests, docs and lint, and the fix rounds they asked for'
	},
	{ key: 'deciding', label: 'Firstmate deciding', hint: 'A review question waiting on Firstmate' },
	{ key: 'ci', label: 'CI checks', hint: 'From the CI checks starting to them passing' },
	{ key: 'captain', label: 'Waiting on you', hint: 'Your review, merge or answer' }
];

export const PHASE_LABEL = {
	building: 'Building',
	review: 'Automated review and fixes',
	ci: 'CI checks'
} as const;

export const CONFIDENCE: Record<WorkEta['confidence'], string> = {
	guide: 'Good guide',
	rough: 'Rough guide',
	early: 'Early guess',
	none: ''
};

/** "45s", "12 min", "1h 5m", "3 days". */
export function duration(seconds: number): string {
	if (seconds < 60) return `${Math.max(0, Math.round(seconds))}s`;
	return minutes(Math.round(seconds / 60));
}

export function minutes(m: number): string {
	if (m < 60) return `${m} min`;
	if (m >= 36 * 60) return `${Math.round(m / 1440)} days`;
	const h = Math.floor(m / 60);
	const r = m % 60;
	return r ? `${h}h ${r}m` : `${h}h`;
}

export const emptySplit = (): Record<TimeSegment, number> => ({
	build: 0,
	review: 0,
	deciding: 0,
	ci: 0,
	captain: 0
});

export function sumSplits(splits: Pick<TimeSplit, 'seconds'>[]): Record<TimeSegment, number> {
	const s = emptySplit();
	for (const x of splits) for (const k of SEGMENTS) s[k.key] += x.seconds[k.key];
	return s;
}

export const total = (s: Record<TimeSegment, number>) =>
	Object.values(s).reduce((a, b) => a + b, 0);

/** The short line on a card: what the estimate says, in plain words. */
export function etaLine(e: WorkEta): {
	text: string;
	tone: 'normal' | 'warning' | 'muted';
	note: string;
} {
	if (e.openEnded) {
		return {
			text: `Under way ${duration(e.elapsed)} · no set end`,
			tone: 'muted',
			note: 'Prototypes and scouting have no fixed end, so there is no estimate.'
		};
	}
	if (e.minutes === null) {
		return {
			text: 'No estimate yet',
			tone: 'muted',
			note: 'Nothing similar has reached your review yet.'
		};
	}
	const basis = `Based on ${e.basis} similar ${e.scope === 'project' ? 'tasks in this project' : 'tasks across projects'}.`;
	if (e.overdue) {
		return {
			text: 'Taking longer than usual',
			tone: 'warning',
			note: `${basis} Similar work had reached your review by this point.`
		};
	}
	return {
		text: `About ${minutes(e.minutes)} left`,
		tone: 'normal',
		note: `${basis} Usually ${e.low}–${e.high} min. A guide, not a promise.`
	};
}

/** "Today", "Yesterday", else the weekday and date. */
export function dayLabel(iso: string, now: number): string {
	const d = new Date(iso);
	const today = new Date(now);
	if (d.toDateString() === today.toDateString()) return 'Today';
	const y = new Date(today);
	y.setDate(y.getDate() - 1);
	if (d.toDateString() === y.toDateString()) return 'Yesterday';
	return d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' });
}

/** Group items by day label, keeping their order. */
export function byDay<T>(items: T[], at: (t: T) => string, now: number): [string, T[]][] {
	const g = new Map<string, T[]>();
	for (const it of items) {
		const k = dayLabel(at(it), now);
		g.set(k, [...(g.get(k) ?? []), it]);
	}
	return [...g.entries()];
}

export const median = (xs: number[]) => {
	if (!xs.length) return 0;
	const s = [...xs].sort((a, b) => a - b);
	return s[Math.floor((s.length - 1) / 2)];
};

/** The filters on Decided for you. */
export const DECISION_FILTERS = ['All', 'Fix it', 'Keep as is', 'No change', 'Defer'] as const;
export type DecisionFilter = (typeof DECISION_FILTERS)[number];
/** Decisions on one page of Decided for you. */
export const DECISIONS_PAGE_SIZE = 100;

/** Whether a decision shows under a filter: its overall verdict or any of its calls'. */
export const decisionMatches = (d: DecisionView, f: Verdict | 'All') =>
	f === 'All' || d.verdict === f || d.calls.some((c) => c.verdict === f);

/** What the address of Decided for you asks for: `?verdict=`, `?page=` (1-based), `?d=<decision id>`. */
export interface DecisionsQuery {
	verdict: DecisionFilter;
	page: number;
	/** A decision to show: the page holding it, under the filter if it matches, else under All. */
	find: string | null;
}

export function decisionsQuery(params: URLSearchParams): DecisionsQuery {
	const v = params.get('verdict');
	const n = Math.floor(Number(params.get('page')));
	return {
		verdict: (DECISION_FILTERS as readonly string[]).includes(v ?? '')
			? (v as DecisionFilter)
			: 'All',
		page: Number.isFinite(n) && n > 0 ? n : 1,
		find: params.get('d') || null
	};
}

/**
 * One page of Decided for you, newest first: the server sends a page, not
 * every decision ever made, so the page stays light however long the ledger.
 */
export function decisionsPage(
	view: DecisionsView,
	q: DecisionsQuery,
	size = DECISIONS_PAGE_SIZE
): DecisionsView {
	const all = view.decisions;
	let verdict: DecisionFilter = q.verdict;
	let matching = all.filter((d) => decisionMatches(d, verdict));
	let number = q.page;
	if (q.find) {
		let at = matching.findIndex((d) => d.id === q.find);
		if (at < 0 && verdict !== 'All' && all.some((d) => d.id === q.find)) {
			verdict = 'All';
			matching = all;
			at = all.findIndex((d) => d.id === q.find);
		}
		if (at >= 0) number = Math.floor(at / size) + 1;
	}
	const pages = Math.max(1, Math.ceil(matching.length / size));
	number = Math.min(number, pages);
	return {
		...view,
		decisions: matching.slice((number - 1) * size, number * size),
		page: { number, pages, size, verdict, matching: matching.length, total: all.length }
	};
}

/** The address of a page of Decided for you. */
export function decisionsHref(verdict: Verdict | 'All', page = 1): string {
	const q = new URLSearchParams();
	if (verdict !== 'All') q.set('verdict', verdict);
	if (page > 1) q.set('page', String(page));
	const s = q.toString();
	return s ? `/decisions?${s}` : '/decisions';
}

/** A link to one decision on Decided for you, on whichever page holds it. */
export const decisionHref = (id: string) => `/decisions?${new URLSearchParams({ d: id })}#${id}`;
