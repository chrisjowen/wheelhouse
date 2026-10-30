import { ago } from '$lib/format';
import { completedAt, harbour, isTrouble, shelf } from '$lib/harbour';
import { PROJECT_LANDED_MS, updatedAt } from '$lib/views';
import type { Project, TaskSummary } from '$lib/types';

/**
 * The Harbour's project cards ("berths"): each project's work sorted by what it asks of
 * the captain, its state in one word and its most important line. Pure, so it is
 * unit-tested; the cards and the project page draw from it.
 */

/**
 * needs-you  something waits on the captain's review or decision
 * held-up    work is blocked, failed, out of contact or at a failed step, or the
 *            project's passage file has problems
 * under-way  work is moving (or queued) and nothing above applies
 * quiet      nothing open
 */
export type ProjectState = 'needs-you' | 'held-up' | 'under-way' | 'quiet';

export const PROJECT_STATES: readonly ProjectState[] = [
	'needs-you',
	'held-up',
	'under-way',
	'quiet'
];

/** How many days of activity a project's card shows. */
export const ACTIVITY_DAYS = 14;

export const STATE_WORDS: Record<ProjectState, string> = {
	'needs-you': 'Needs you',
	'held-up': 'Held up',
	'under-way': 'Under way',
	quiet: 'Quiet'
};

export interface Berth {
	project: Project;
	state: ProjectState;
	/** Waiting on the captain: reviews and decisions. */
	yourMove: TaskSummary[];
	/** Open work that is stuck: blocked, failed, out of contact, unreadable or at a failed step. */
	heldUp: TaskSummary[];
	/** The rest of the open work: moving first, then what is with Firstmate or reviewers. */
	moving: TaskSummary[];
	queued: TaskSummary[];
	/** Landed in the last week, newest first. */
	landed: TaskSummary[];
	/** The latest landing, however long ago. */
	lastLanded: TaskSummary | null;
	/** When each landed task landed, as epoch ms, newest first. */
	landings: number[];
	/** Work under way, held up or moving (not what needs you, not queued). */
	underWay: number;
	/** Open work with a pull request. */
	openPullRequests: number;
	/** When anything last happened in the project, as epoch ms. */
	lastActivity: number | null;
}

const failedStep = (t: TaskSummary) => !!t.passage.steps[t.passage.current]?.failed;

export function berth(project: Project, tasks: TaskSummary[], now: number): Berth {
	const open = shelf(tasks, 'under-way');
	const h = harbour(open, now);
	const stuck = (t: TaskSummary) => isTrouble(t) || failedStep(t);
	const heldUp = h.underWay.filter(stuck);
	const moving = [
		...h.underWay.filter((t) => !stuck(t)),
		...h.waitingOnFirstmate,
		...h.waitingOnReviewers
	];
	const done = shelf(tasks, 'completed').filter((t) => t.status === 'landed');
	const landed = done.filter((t) => {
		const at = completedAt(t);
		return at !== null && now - at <= PROJECT_LANDED_MS;
	});
	const times = tasks.map((t) => updatedAt(t)).filter((x): x is number => x !== null);
	const state: ProjectState = h.needsYou.length
		? 'needs-you'
		: heldUp.length || project.passage?.problems
			? 'held-up'
			: open.length
				? 'under-way'
				: 'quiet';
	return {
		project,
		state,
		yourMove: h.needsYou,
		heldUp,
		moving,
		queued: h.queued,
		landed,
		lastLanded: done[0] ?? null,
		landings: done.map((t) => completedAt(t)).filter((x): x is number => x !== null),
		underWay: heldUp.length + moving.length,
		openPullRequests: open.filter((t) => t.pr).length,
		lastActivity: times.length ? Math.max(...times) : null
	};
}

const stop = (s: string) => s.trim().replace(/[.\s]+$/, '');
const stepLabel = (t: TaskSummary) => t.passage.steps[t.passage.current]?.label ?? null;

/** The one thing that matters most about a project right now, in a sentence. */
export function projectLine(b: Berth, now: number): string {
	const move = b.yourMove[0];
	if (move)
		return move.attention?.text
			? `${move.shortTitle}: ${stop(move.attention.text)}.`
			: `${move.shortTitle} needs you.`;
	const held = b.heldUp[0];
	if (held)
		return failedStep(held)
			? `${held.shortTitle}: ${stepLabel(held)} failed.`
			: `${held.shortTitle}: ${stop(held.statusLabel)}.`;
	if (b.project.passage?.problems) return 'Its passage file has problems.';
	const going = b.moving[0];
	if (going) {
		if (going.activity?.text) return `${going.shortTitle}: ${stop(going.activity.text)}.`;
		const label = stepLabel(going);
		return label ? `${going.shortTitle} is at ${label}.` : `${going.shortTitle} is under way.`;
	}
	if (b.queued.length) return `Nothing under way. ${b.queued.length} queued.`;
	const last = b.lastLanded;
	const at = last ? completedAt(last) : null;
	if (last && at !== null)
		return `Nothing under way. ${last.shortTitle} landed ${ago(new Date(at).toISOString(), now)}.`;
	return 'No work yet.';
}

/** Most pressing first (needs you, held up, under way, quiet), then the latest activity. */
export function byAttention(berths: Berth[]): Berth[] {
	return berths.toSorted(
		(a, b) =>
			PROJECT_STATES.indexOf(a.state) - PROJECT_STATES.indexOf(b.state) ||
			(b.lastActivity ?? -Infinity) - (a.lastActivity ?? -Infinity) ||
			a.project.name.localeCompare(b.project.name)
	);
}

/** The Harbour's state filter, from `?show=`; anything else shows every project. */
export function stateOf(value: string | null): ProjectState | null {
	return PROJECT_STATES.find((s) => s === value) ?? null;
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The Harbour's headline over every project's card. */
export function fleetHeadline(berths: Berth[]): string {
	const projects = berths.filter((b) => b.project.id !== 'unassigned').length;
	const sum = (f: (b: Berth) => number) => berths.reduce((n, b) => n + f(b), 0);
	const needs = sum((b) => b.yourMove.length);
	const under = sum((b) => b.underWay);
	const held = sum((b) => b.heldUp.length);
	const landed = sum((b) => b.landed.length);
	return [
		`${count(projects, 'project', 'projects')}.`,
		needs ? `${count(needs, 'thing needs', 'things need')} you;` : 'Nothing needs you;',
		under ? `${under} under way${held ? `, ${held} of them held up` : ''};` : 'nothing under way;',
		landed ? `${landed} landed this week.` : 'nothing landed this week.'
	].join(' ');
}

/** How many of these times fall on each of the last `days` local days, oldest first. */
export function dayCounts(times: number[], now: number, days: number): number[] {
	const out = new Array<number>(days).fill(0);
	const today = new Date(now);
	today.setHours(0, 0, 0, 0);
	for (const t of times) {
		if (t > now) continue;
		const d = new Date(t);
		d.setHours(0, 0, 0, 0);
		const back = Math.round((today.getTime() - d.getTime()) / 86_400_000);
		if (back >= 0 && back < days) out[days - 1 - back]++;
	}
	return out;
}
