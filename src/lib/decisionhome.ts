/**
 * The Decisions home: every open decision in one list, sorted by what needs the
 * captain first (the work waits on them, then whatever has waited longest),
 * filtered by project and type. The chat, On deck's Needs you and a task's page
 * do not show copies of it: they show a badge that opens the Decisions
 * slide-out on the same cards, filtered to the task or project
 * (lib/client/slideout.svelte.ts), where each is answered through the inbox as
 * before. Links to a task's page open the task slide-out (taskLink), and links
 * to one decision (cardHref) its slide-out (cardLink). Pure, so it is unit-tested.
 */
import { awaitsAnswer, escalated, followKey, type InboxCard, type InboxKind } from './inbox';

/** What a decision is, in a word or two. */
export const KIND_LABEL: Record<InboxKind, string> = {
	hold: 'Your call',
	merge: 'Merge call',
	preview: 'Preview sign-off',
	decision: 'Decision',
	blocked: 'Stuck',
	review: 'Review question'
};

/** The types in the order the filter offers them: those escalated to the captain first. */
export const KIND_ORDER: readonly InboxKind[] = [
	'hold',
	'merge',
	'preview',
	'decision',
	'blocked',
	'review'
];

export type DecisionSort = 'needs' | 'oldest' | 'newest';

export const SORTS: { id: DecisionSort; label: string }[] = [
	{ id: 'needs', label: 'Needs you first' },
	{ id: 'oldest', label: 'Waiting longest' },
	{ id: 'newest', label: 'Newest' }
];

/** Which decisions a list or badge is about: one task's, one project's, one type's (all when empty). */
export interface DecisionFilter {
	taskId?: string | null;
	projectId?: string | null;
	kind?: InboxKind | null;
}

/**
 * Where a decision stands for the captain, in the order the list puts them: the
 * work waits on them (Firstmate escalated it), they are talking it through in
 * the chat, or Firstmate is handling it unless they step in.
 */
export type Standing = 'waiting' | 'following' | 'firstmate';

export function standing(c: Pick<InboxCard, 'owner' | 'following'>): Standing {
	if (!escalated(c)) return 'firstmate';
	return c.following ? 'following' : 'waiting';
}

export const STANDING_LABEL: Record<Standing, string> = {
	waiting: 'Waiting on you',
	following: 'Following up in the chat',
	firstmate: 'Firstmate is handling it'
};

const RANK: Record<Standing, number> = { waiting: 0, following: 1, firstmate: 2 };

const asked = (c: Pick<InboxCard, 'askedAt'>) => {
	const t = c.askedAt ? Date.parse(c.askedAt) : NaN;
	return Number.isNaN(t) ? null : t;
};

/** Oldest first; a question with no time asked goes last. */
function byAge(a: InboxCard, b: InboxCard): number {
	const x = asked(a);
	const y = asked(b);
	if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1;
	return x - y;
}

/**
 * The cards in the order asked for. `needs` (the default): those the work waits
 * on the captain for, then those being followed up in the chat, then those
 * Firstmate is handling, each waiting longest first.
 */
export function sortDecisions(cards: InboxCard[], sort: DecisionSort = 'needs'): InboxCard[] {
	const out = [...cards];
	if (sort === 'oldest') return out.sort(byAge);
	if (sort === 'newest') return out.sort((a, b) => byAge(b, a));
	return out.sort((a, b) => RANK[standing(a)] - RANK[standing(b)] || byAge(a, b));
}

/** The task a card is about, as the fleet names it (`<task>@<mate>` for a second mate's). */
export const cardTask = (c: Pick<InboxCard, 'taskId' | 'secondMate'>) => followKey(c);

/** Whether a card is one the filter is about. */
export function inFilter(c: InboxCard, f: DecisionFilter | null | undefined): boolean {
	if (!f) return true;
	if (f.taskId && c.taskId !== f.taskId && cardTask(c) !== f.taskId) return false;
	if (f.projectId && c.projectId !== f.projectId) return false;
	if (f.kind && c.kind !== f.kind) return false;
	return true;
}

/** The open decisions (no answer has reached Firstmate yet) the filter is about, sorted. */
export function openDecisions(
	cards: InboxCard[],
	f: DecisionFilter | null = null,
	sort: DecisionSort = 'needs'
): InboxCard[] {
	return sortDecisions(
		cards.filter((c) => awaitsAnswer(c) && inFilter(c, f)),
		sort
	);
}

/** "3 decisions", "1 decision". */
export const decisionCount = (n: number) => `${n} ${n === 1 ? 'decision' : 'decisions'}`;

/**
 * A link to a task's page (`/tasks/<id>`, `?tab=` kept), which opens the task
 * slide-out instead; null for anything else, a task's own sub-pages included.
 */
export function taskLink(url: URL): { id: string; tab: string | null } | null {
	const m = /^\/tasks\/([^/]+)\/?$/.exec(url.pathname);
	if (!m) return null;
	let id: string;
	try {
		id = decodeURIComponent(m[1]);
	} catch {
		return null;
	}
	return id ? { id, tab: url.searchParams.get('tab') } : null;
}

/** A link to one decision on the Decisions page (`/inbox#card-<id>`), which opens its slide-out instead. */
export function cardLink(url: URL): string | null {
	if (url.pathname !== '/inbox' || !url.hash.startsWith('#card-')) return null;
	try {
		return decodeURIComponent(url.hash.slice('#card-'.length)) || null;
	} catch {
		return null;
	}
}
