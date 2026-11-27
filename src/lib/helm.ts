import { isTrouble, needsYou } from './harbour';
import type { TaskSummary } from './types';

/**
 * What the calm mark (focus mode's HelmMark) shows, read from the fleet: one
 * animation at a time, with its tint and speed, and a short legend saying why.
 * Nothing under way leaves it still. Otherwise the most important thing wins:
 * a call waiting on the captain (a slow warm lighthouse beam), then a stuck or
 * failed worker (a slow red pulse), then checks running (a swell with pings),
 * then work being built (the gold mood cycle), then a scout looking into
 * something (a cool lantern). Speed rises gently with how many workers are
 * busy. A task that has just landed turns the wheel once, as a flourish, over
 * whatever is showing. Pure, so it is unit-tested.
 */

/** What the mark is showing, most important first (`rest` last: nothing to show). */
export type HelmKind = 'captain' | 'stuck' | 'checks' | 'building' | 'scouting' | 'rest';

/** The five Calm animations, plus none. */
export type HelmIdea = 'lighthouse' | 'pulse' | 'swell' | 'mood' | 'lantern' | 'still';

export type HelmTint = 'amber' | 'red' | 'teal' | 'gold' | 'cool';

export interface Helm {
	kind: HelmKind;
	idea: HelmIdea;
	tint: HelmTint;
	/** How fast it moves, against its own pace: 1 is as designed. */
	tempo: number;
	counts: Record<Exclude<HelmKind, 'rest'>, number>;
	/** Firstmate itself is mid-turn. */
	firstmate: boolean;
	/** What it shows, in a few words, e.g. "2 building · 1 waiting on you"; empty at rest. */
	legend: string;
}

const LOOK: Record<HelmKind, { idea: HelmIdea; tint: HelmTint; pace: number }> = {
	captain: { idea: 'lighthouse', tint: 'amber', pace: 0.75 },
	stuck: { idea: 'pulse', tint: 'red', pace: 0.6 },
	checks: { idea: 'swell', tint: 'teal', pace: 1 },
	building: { idea: 'mood', tint: 'gold', pace: 1 },
	scouting: { idea: 'lantern', tint: 'cool', pace: 0.8 },
	rest: { idea: 'still', tint: 'gold', pace: 1 }
};

const ORDER: Exclude<HelmKind, 'rest'>[] = ['captain', 'stuck', 'checks', 'building', 'scouting'];

const PHRASE: Record<Exclude<HelmKind, 'rest'>, (n: number) => string> = {
	captain: (n) => `${n} waiting on you`,
	stuck: (n) => `${n} stuck`,
	checks: (n) => `${n} in checks`,
	building: (n) => `${n} building`,
	scouting: (n) => `${n} scouting`
};

/** Stuck: a worker that is blocked, failed or out of contact (not merely unreadable). */
const stuck = (t: TaskSummary) => isTrouble(t) && t.status !== 'unknown';
/** Checks: a validation run under way and not held at a gate. */
const checking = (t: TaskSummary) => t.pipeline?.outcome === 'running' && !t.pipeline.gate;
const settled = (t: TaskSummary) =>
	t.status === 'landed' || t.status === 'closed' || t.status === 'queued';

/** Which one thing a task counts towards, if any: the most important that holds. */
function kindOf(t: TaskSummary): Exclude<HelmKind, 'rest' | 'captain'> | null {
	if (settled(t) || needsYou(t)) return null;
	if (stuck(t)) return 'stuck';
	if (checking(t)) return 'checks';
	if (!t.busy) return null;
	return t.track === 'scout' ? 'scouting' : 'building';
}

/**
 * The mark for these tasks: `calls` is how many calls wait on the captain (the
 * inbox's count; tasks that need the captain count too when it is lower), and
 * `firstmate` whether Firstmate itself is mid-turn, which counts as building.
 */
export function helmOf(tasks: TaskSummary[], calls: number, firstmate: boolean): Helm {
	const counts = { captain: 0, stuck: 0, checks: 0, building: 0, scouting: 0 };
	for (const t of tasks) {
		const k = kindOf(t);
		if (k) counts[k]++;
	}
	counts.captain = Math.max(calls, tasks.filter((t) => needsYou(t) && !settled(t)).length);
	const kind =
		ORDER.find((k) => counts[k] > 0) ?? (firstmate ? ('building' as const) : ('rest' as const));
	const look = LOOK[kind];
	const busy = counts.checks + counts.building + counts.scouting + (firstmate ? 1 : 0);
	const tempo = kind === 'rest' ? 1 : look.pace * (1 + 0.12 * Math.min(Math.max(busy - 1, 0), 5));
	const parts = ORDER.filter((k) => counts[k] > 0).map((k) => PHRASE[k](counts[k]));
	if (firstmate && !counts.building) parts.push('Firstmate at work');
	return {
		kind,
		idea: look.idea,
		tint: look.tint,
		tempo: Math.round(tempo * 100) / 100,
		counts,
		firstmate,
		legend: parts.join(' · ')
	};
}

/**
 * Tasks that have landed since the mark last looked: `known` is the landed
 * tasks it has seen (null on the first look, when nothing counts as new).
 */
export function newlyLanded(
	known: Set<string> | null,
	tasks: Pick<TaskSummary, 'id' | 'status'>[]
): { known: Set<string>; landed: string[] } {
	const now = new Set(tasks.filter((t) => t.status === 'landed').map((t) => t.id));
	return { known: now, landed: known ? [...now].filter((id) => !known.has(id)) : [] };
}
