import { ago } from '$lib/format';
import { completedAt, harbour, isTrouble, shelf } from '$lib/harbour';
import { stay } from '$lib/radar';
import { PROJECT_LANDED_MS, updatedAt } from '$lib/views';
import type { Project, TaskSummary } from '$lib/types';

const ms = (iso: string | null | undefined) => {
	const t = iso ? Date.parse(iso) : NaN;
	return Number.isNaN(t) ? null : t;
};

/**
 * The Harbour's project cards ("berths"): each project's work sorted by what it asks of
 * the captain, its state in one word and its most important line. Pure, so it is
 * unit-tested; the cards and the project page draw from it.
 */

/**
 * needs-you  something waits on the captain's review or decision
 * held-up    work is blocked, failed, out of contact or at a failed step, or the
 *            project's passage file has problems
 * new        work is moving (or queued) in a project that has finished nothing yet and
 *            whose first work is from the last ACTIVITY_DAYS days, and nothing above applies
 * under-way  work is moving (or queued) and nothing above applies
 * quiet      nothing open
 */
export type ProjectState = 'needs-you' | 'held-up' | 'new' | 'under-way' | 'quiet';

export const PROJECT_STATES: readonly ProjectState[] = [
	'needs-you',
	'held-up',
	'new',
	'under-way',
	'quiet'
];

/** How recent a project's first work must be for it to read as new, in days. */
export const ACTIVITY_DAYS = 14;

export const STATE_WORDS: Record<ProjectState, string> = {
	'needs-you': 'Needs you',
	'held-up': 'Held up',
	new: 'New',
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
	const completed = shelf(tasks, 'completed');
	const done = completed.filter((t) => t.status === 'landed');
	const landed = done.filter((t) => {
		const at = completedAt(t);
		return at !== null && now - at <= PROJECT_LANDED_MS;
	});
	const times = tasks.map((t) => updatedAt(t)).filter((x): x is number => x !== null);
	const starts = tasks.map((t) => ms(t.since)).filter((x): x is number => x !== null);
	const isNew =
		!completed.length &&
		starts.length > 0 &&
		Math.min(...starts) >= now - ACTIVITY_DAYS * 86_400_000;
	const state: ProjectState = h.needsYou.length
		? 'needs-you'
		: heldUp.length || project.passage?.problems
			? 'held-up'
			: open.length
				? isNew
					? 'new'
					: 'under-way'
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

/** A line without its closing full stop, to end it with one of our own. */
export const stop = (s: string) => s.trim().replace(/[.\s]+$/, '');
const stepLabel = (t: TaskSummary) => t.passage.steps[t.passage.current]?.label ?? null;

/**
 * How long a task has been as it is, as a sentence to follow another: " Waiting for
 * 3 h." It counts from its latest status line or validation run, else from when it
 * started; a crew-state read only says when it was read, so it never counts. Empty
 * when nothing says.
 */
export function lasted(what: string, t: TaskSummary, now: number): string {
	const times = [t.activity?.source === 'state' ? null : ms(t.activity?.at), ms(t.since)].filter(
		(x): x is number => x !== null
	);
	return times.length ? ` ${what} for ${stay(Math.max(...times), now)}.` : '';
}

/** The one thing that matters most about a project right now, in a sentence. */
export function projectLine(b: Berth, now: number): string {
	const move = b.yourMove[0];
	if (move)
		return (
			(move.attention?.text
				? `${move.shortTitle}: ${stop(move.attention.text)}.`
				: `${move.shortTitle} needs you.`) + lasted('Waiting', move, now)
		);
	const held = b.heldUp[0];
	if (held)
		return (
			(failedStep(held)
				? `${held.shortTitle}: ${stepLabel(held)} failed.`
				: `${held.shortTitle}: ${stop(held.statusLabel)}.`) + lasted('Held up', held, now)
		);
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

/** Most pressing first (needs you, held up, new, under way, quiet), then the latest activity. */
export function byAttention(berths: Berth[]): Berth[] {
	return berths.toSorted(
		(a, b) =>
			PROJECT_STATES.indexOf(a.state) - PROJECT_STATES.indexOf(b.state) ||
			(b.lastActivity ?? -Infinity) - (a.lastActivity ?? -Infinity) ||
			a.project.name.localeCompare(b.project.name)
	);
}
