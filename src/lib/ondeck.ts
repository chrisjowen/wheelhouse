import { runStep } from '$lib/changes';
import { showsChecks } from '$lib/checks';
import { harbour, railUnderWay, type Harbour } from '$lib/harbour';
import { escalated, type InboxCard } from '$lib/inbox';
import type { SecondMate, TaskSummary } from '$lib/types';

/**
 * On deck, the home page's rail, as one line per piece of work: what sits
 * under each tab, whose crew runs it (Firstmate's own, or a second mate's),
 * the one state a line carries and its age. Pure, so it is unit-tested; the
 * rail (Rail.svelte) only draws it.
 */

/** Firstmate's own crew. Not a valid second mate id, so it can never clash with one. */
export const OWN_CREW = ':firstmate';
/** All crews at once: the crew toggle's first segment. */
export const ALL_CREWS = 'all';

export interface Crew {
	id: string;
	/** Its full name: "Firstmate", or the second mate's id. */
	label: string;
	/** The toggle's short name (a suffix every second mate shares dropped). */
	short: string;
	mate: SecondMate | null;
}

/** Whose crew runs a task: the second mate whose home it is in, else Firstmate's own. */
export const crewOfTask = (t: Pick<TaskSummary, 'secondMate'>) => t.secondMate?.id ?? OWN_CREW;

/** Whose crew a decision is about: the second mate it came from, or the task's crew. */
export function crewOfCard(c: InboxCard, tasks: TaskSummary[]): string {
	if (c.secondMate) return c.secondMate.id;
	const t = tasks.find((x) => x.id === c.taskId);
	return t ? crewOfTask(t) : OWN_CREW;
}

/**
 * A suffix every second mate's id shares (such as "-mate" in "hostinger-mate" and
 * "aws-mate"), dropped from the toggle's short names as a project tag drops a shared
 * prefix; empty when there are fewer than two, or no such suffix.
 */
export function sharedSuffix(ids: string[]): string {
	if (ids.length < 2) return '';
	const m = ids[0].match(/[-_.][^-_.]+$/)?.[0];
	return m && ids.every((id) => id.endsWith(m) && id.length > m.length) ? m : '';
}

/**
 * Firstmate's own crew first, then each second mate in the fleet's order, then any
 * crew `lines` name that the fleet's second mates do not (say, a second mate the
 * latest read left out), so no line is ever without its group.
 */
export function crewsOf(mates: SecondMate[], lines: Pick<DeckLine, 'crew'>[] = []): Crew[] {
	const ids = [...new Set(lines.map((l) => l.crew))].filter(
		(id) => id !== OWN_CREW && !mates.some((m) => m.id === id)
	);
	const suffix = sharedSuffix([...mates.map((m) => m.id), ...ids]);
	const short = (id: string) => (suffix ? id.slice(0, -suffix.length) : id);
	return [
		{ id: OWN_CREW, label: 'Firstmate', short: 'Firstmate', mate: null },
		...mates.map((m) => ({ id: m.id, label: m.id, short: short(m.id), mate: m })),
		...ids.map((id) => ({ id, label: id, short: short(id), mate: null }))
	];
}

/** A remembered crew, or All when it is absent or no longer in the fleet. */
export const crewChoice = (saved: string | null, crews: Crew[]) =>
	saved && crews.some((c) => c.id === saved) ? saved : ALL_CREWS;

export const inCrew = (crew: string, id: string) => crew === ALL_CREWS || crew === id;

export type Tone = 'danger' | 'warning' | 'sea' | 'muted' | 'busy' | 'success' | 'quiet';

/** Which icon a line's state draws (Rail.svelte maps each to its Lucide icon). */
export type LineIcon =
	| 'failed'
	| 'stuck'
	| 'lost'
	| 'merge'
	| 'review'
	| 'call'
	| 'reviewers'
	| 'changes'
	| 'firstmate'
	| 'queued'
	| 'landed'
	| 'moving';

/** The one state a line carries: an icon and words, never colour alone. */
export interface LineState {
	label: string;
	icon: LineIcon;
	tone: Tone;
}

/** A task's state on its line: anything wrong or waiting on someone first, then how it is moving. */
export function lineState(t: TaskSummary): LineState {
	const step = t.passage.steps[t.passage.current];
	if (step?.failed) return { label: `${step.label} failed`, icon: 'failed', tone: 'danger' };
	if (t.status === 'failed') return { label: 'Failed', icon: 'failed', tone: 'danger' };
	if (t.status === 'blocked') return { label: 'Stuck', icon: 'stuck', tone: 'danger' };
	if (t.status === 'lost' || t.status === 'unknown')
		return { label: 'Not responding', icon: 'lost', tone: 'warning' };
	if (t.attention?.owner === 'captain')
		return t.attention.kind === 'review'
			? t.attention.approved
				? { label: 'Your merge', icon: 'merge', tone: 'sea' }
				: { label: 'Your review', icon: 'review', tone: 'sea' }
			: { label: 'Your call', icon: 'call', tone: 'sea' };
	if (t.attention?.owner === 'reviewers')
		return { label: 'With reviewers', icon: 'reviewers', tone: 'muted' };
	if (t.addressingReview)
		return { label: runStep(t) ?? 'Changes requested', icon: 'changes', tone: 'muted' };
	if (t.status === 'with-firstmate')
		return { label: 'Firstmate deciding', icon: 'firstmate', tone: 'warning' };
	if (t.status === 'queued') return { label: 'Queued', icon: 'queued', tone: 'quiet' };
	if (t.status === 'landed') return { label: 'Landed', icon: 'landed', tone: 'success' };
	if (showsChecks(t))
		return {
			label: `Checks: ${t.pipeline.label}`,
			icon: 'moving',
			tone: t.busy ? 'busy' : 'muted'
		};
	return { label: t.busy ? 'Working' : 'Idle', icon: 'moving', tone: t.busy ? 'busy' : 'muted' };
}

/** A decision's line state. */
export const DECISION_STATE: LineState = { label: 'Your call', icon: 'call', tone: 'sea' };

/** Short age for a line's right-hand column: now, 4m, 2h, 3d. */
export function shortAge(iso: string | null | undefined, now: number): string {
	const t = iso ? Date.parse(iso) : NaN;
	if (Number.isNaN(t)) return '';
	const s = Math.max(0, (now - t) / 1000);
	if (s < 60) return 'now';
	const m = Math.round(s / 60);
	if (m < 60) return `${m}m`;
	const h = Math.round(m / 60);
	if (h < 24) return `${h}h`;
	return `${Math.round(h / 24)}d`;
}

/** One line on deck: a task, or an escalated decision from the inbox. */
export type DeckLine =
	| {
			kind: 'task';
			key: string;
			task: TaskSummary;
			/** What the line says: the ask for a decision or a failed step, else the title. */
			text: string;
			crew: string;
			/** When its age counts from. */
			at: string | null;
	  }
	| {
			kind: 'decision';
			key: string;
			card: InboxCard;
			text: string;
			crew: string;
			at: string | null;
	  };

const taskLine = (t: TaskSummary, text: string): DeckLine => ({
	kind: 'task',
	key: `task:${t.id}`,
	task: t,
	text,
	crew: crewOfTask(t),
	at: t.mergedAt ?? t.activity?.at ?? t.since
});

export interface Deck {
	h: Harbour;
	/** Needs you: escalated decisions, failed steps, then reviews and calls on tasks. */
	needs: DeckLine[];
	/** Workers' questions Firstmate is handling. */
	withFirstmate: DeckLine[];
	under: DeckLine[];
	next: DeckLine[];
	landed: DeckLine[];
}

/**
 * The rail's lines, from the tasks it is given (already scoped to a project by the
 * page). `inbox` is the decision inbox (null when it cannot be read, so tasks held
 * for the captain keep their own line): `shown`, the open questions still showing,
 * kept to `scope`'s project, and `all` its cards, answered and snoozed ones too. A
 * task held for the captain is never a line of its own: it shows as its decision
 * while that is open, and leaves with it. A pull request waiting on the captain's
 * review shows as its merge call while that call is showing, else as its own line.
 * A question about a second mate's task is about `<task>@<mate>`, the id that task
 * has here.
 */
export function deckOf(
	tasks: TaskSummary[],
	now: number,
	inbox: { shown: InboxCard[]; all: InboxCard[] } | null,
	scope: string | null = null
): Deck {
	const inScope = (projectId: string | null) => !scope || projectId === scope;
	const h = harbour(tasks, now);
	const shown = (inbox?.shown ?? []).filter((c) => escalated(c) && inScope(c.projectId));
	const about = (c: InboxCard) =>
		c.secondMate?.taskId ? `${c.secondMate.taskId}@${c.secondMate.id}` : c.taskId;
	const holds = new Set((inbox?.all ?? []).filter((c) => c.kind === 'hold').map(about));
	// A green pull request's merge call stands for its review while the call is showing.
	const merges = new Set(shown.filter((c) => c.kind === 'merge').map(about));
	const failedIds = new Set(h.stepFailed.map((t) => t.id));
	const failed = h.stepFailed.filter((t) => !h.needsYou.includes(t));
	const needsYou = h.needsYou.filter(
		(t) =>
			!(t.attention?.kind === 'decision' && holds.has(t.id)) &&
			!(t.attention?.kind === 'review' && merges.has(t.id))
	);
	// Reviews and failures name the work (the line's icon says which); a question is its ask.
	const askOr = (t: TaskSummary) =>
		t.attention?.kind === 'decision' ? t.attention.text || t.shortTitle : t.shortTitle;
	return {
		h,
		needs: [
			...shown.map((c): DeckLine => ({
				kind: 'decision',
				key: `decision:${c.id}`,
				card: c,
				text: c.question,
				crew: crewOfCard(c, tasks),
				at: c.askedAt
			})),
			...failed.map((t) => taskLine(t, t.shortTitle)),
			...needsYou.map((t) => taskLine(t, askOr(t)))
		],
		withFirstmate: h.waitingOnFirstmate
			.filter((t) => !failedIds.has(t.id))
			.map((t) => taskLine(t, askOr(t))),
		under: railUnderWay(h)
			.filter((t) => !failedIds.has(t.id))
			.map((t) => taskLine(t, t.shortTitle)),
		next: h.queued.map((t) => taskLine(t, t.shortTitle)),
		landed: h.landedRecent.filter((t) => !failedIds.has(t.id)).map((t) => taskLine(t, t.shortTitle))
	};
}

/** Lines split by crew, in crew order; a crew with none drops out unless it is the one picked. */
export function byCrew(lines: DeckLine[], crews: Crew[], crew: string) {
	return crews
		.filter((c) => inCrew(crew, c.id))
		.map((c) => ({ crew: c, lines: lines.filter((l) => l.crew === c.id) }))
		.filter((g) => g.lines.length || crew !== ALL_CREWS);
}
