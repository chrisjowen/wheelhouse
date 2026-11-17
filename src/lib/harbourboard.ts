import { ago } from '$lib/format';
import { berth, byAttention, type Berth } from '$lib/berths';
import { completedAt, isCompleted, isTrouble, LANDED_RECENT_MS, needsYou } from '$lib/harbour';
import type { Project, TaskSummary } from '$lib/types';

/**
 * The Harbour board: one kanban for the whole fleet. Its columns are the states a task
 * walks through, its swimlanes the projects, and each task sits in its state's column in
 * its project's lane. Projects with nothing on the board fold into a row of their own
 * (quiet waters). Pure, so it is unit-tested; the Harbour page draws from it.
 */

export type BoardColumn = 'queued' | 'building' | 'pr' | 'you' | 'landed';

export const BOARD_COLUMNS: readonly { key: BoardColumn; name: string; hint: string }[] = [
	{ key: 'queued', name: 'Queued', hint: 'Not started or waiting on other work' },
	{ key: 'building', name: 'Building', hint: 'A crewmate is on it' },
	{ key: 'pr', name: 'Checks & PR', hint: 'Validation and pull request' },
	{ key: 'you', name: 'Waiting on you', hint: 'A decision or your review' },
	{ key: 'landed', name: 'Landed', hint: 'Merged or done, last 24 h' }
];

/** Where a task sits on the board, or null when it is off it (closed, or landed over a day ago). */
export function boardColumn(t: TaskSummary, now: number): BoardColumn | null {
	if (needsYou(t) || t.status === 'needs-decision' || t.status === 'needs-review') return 'you';
	if (t.status === 'closed') return null;
	if (isCompleted(t)) {
		const at = completedAt(t);
		return at !== null && now - at <= LANDED_RECENT_MS ? 'landed' : null;
	}
	if (t.status === 'queued') return 'queued';
	if (t.status === 'with-reviewers') return 'pr';
	const column = t.passage.steps[t.passage.current]?.column;
	return column === 'checks' || column === 'pr' || column === 'review' ? 'pr' : 'building';
}

export interface BoardLane {
	project: Project;
	berth: Berth;
	cells: Record<BoardColumn, TaskSummary[]>;
	/** Open work that is stuck: blocked, failed, out of contact or unreadable. */
	heldUp: number;
}

export interface Board {
	/** Projects with anything on the board, most pressing first. */
	lanes: BoardLane[];
	/** Projects with nothing on the board, by name. */
	quiet: Project[];
}

const emptyCells = (): Record<BoardColumn, TaskSummary[]> => ({
	queued: [],
	building: [],
	pr: [],
	you: [],
	landed: []
});

export function board(projects: Project[], tasks: TaskSummary[], now: number): Board {
	const byProject = new Map<string, TaskSummary[]>(projects.map((p) => [p.id, []]));
	for (const t of tasks) byProject.get(t.projectId)?.push(t);
	const berths = byAttention(projects.map((p) => berth(p, byProject.get(p.id) ?? [], now)));
	const lanes: BoardLane[] = [];
	const quiet: Project[] = [];
	for (const b of berths) {
		const cells = emptyCells();
		for (const t of byProject.get(b.project.id) ?? []) {
			const column = boardColumn(t, now);
			if (column) cells[column].push(t);
		}
		const open = Object.values(cells).some((c) => c.length);
		if (open)
			lanes.push({
				project: b.project,
				berth: b,
				cells,
				heldUp: [...cells.building, ...cells.pr].filter(isTrouble).length
			});
		else if (b.project.id !== 'unassigned') quiet.push(b.project);
	}
	quiet.sort((a, b) => a.name.localeCompare(b.name));
	return { lanes, quiet };
}

/** How many tasks a lane holds in a column. */
export const count = (lane: BoardLane, column: BoardColumn) => lane.cells[column].length;

/** Work under way in a lane: building, or at checks and its pull request. */
export const underWay = (lane: BoardLane) => count(lane, 'building') + count(lane, 'pr');

export type BoardFilter = 'needs-you' | 'under-way' | 'queued';

export const BOARD_FILTERS: readonly { key: BoardFilter; label: string }[] = [
	{ key: 'needs-you', label: 'Needs you' },
	{ key: 'under-way', label: 'Under way' },
	{ key: 'queued', label: 'Queued' }
];

/** The board's filter, from `?show=`; anything else shows every lane. */
export const boardFilterOf = (value: string | null): BoardFilter | null =>
	BOARD_FILTERS.find((f) => f.key === value)?.key ?? null;

/** Whether a lane shows under this filter (null shows every lane). */
export function laneShows(lane: BoardLane, filter: BoardFilter | null): boolean {
	if (filter === 'needs-you') return count(lane, 'you') > 0;
	if (filter === 'under-way') return underWay(lane) > 0;
	if (filter === 'queued') return count(lane, 'queued') > 0;
	return true;
}

/** How many cards a lane's column shows before "+ N more": landed work stays short. */
export const CELL_CAP: Record<BoardColumn, number> = {
	queued: 6,
	building: 6,
	pr: 6,
	you: 6,
	landed: 2
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * The board's headline, in two parts: what waits on the captain (drawn in gold, null when
 * nothing does) and the rest of the fleet in a clause.
 */
export function boardHeadline(lanes: BoardLane[]): { you: string | null; rest: string } {
	const sum = (f: (l: BoardLane) => number) => lanes.reduce((n, l) => n + f(l), 0);
	const you = sum((l) => count(l, 'you'));
	const held = sum((l) => l.heldUp);
	const moving = sum(underWay) - held;
	const projects = lanes.filter((l) => underWay(l) - l.heldUp > 0).length;
	const landed = sum((l) => count(l, 'landed'));
	const rest = [
		moving
			? `${plural(moving, 'task', 'tasks')} under way in ${plural(projects, 'project', 'projects')}`
			: 'nothing under way',
		held ? `${held} held up` : null,
		`${landed} landed today`
	]
		.filter(Boolean)
		.join(', ');
	return {
		you: you ? `${plural(you, 'thing waits', 'things wait')} on you` : null,
		rest: `${you ? '' : 'Nothing waits on you; '}${rest}.`
	};
}

export type CardTone = 'you' | 'working' | 'trouble' | 'landed' | 'quiet';

/** Who or what a card waits on, in a few words, and how it reads (its dot and colour). */
export function cardWait(
	t: TaskSummary,
	column: BoardColumn,
	now: number
): { text: string; tone: CardTone; when: string | null } {
	const since = (iso: string | null | undefined) => (iso ? ago(iso, now) : null);
	if (column === 'you')
		return {
			text: t.attention?.approved
				? 'Yours to merge'
				: t.attention?.kind === 'review' || t.status === 'needs-review'
					? 'Waiting on your review'
					: 'Waiting on you',
			tone: 'you',
			when: null
		};
	if (column === 'landed') {
		const at = completedAt(t);
		return {
			text: t.pr ? `Merged · #${t.pr.number}` : 'Done',
			tone: 'landed',
			when: at === null ? null : ago(new Date(at).toISOString(), now)
		};
	}
	if (isTrouble(t)) return { text: t.statusLabel, tone: 'trouble', when: null };
	if (column === 'queued')
		return {
			text: t.blockedBy.length ? `After ${t.blockedBy.join(', ')}` : 'Not started',
			tone: 'quiet',
			when: null
		};
	if (t.status === 'with-firstmate')
		return { text: 'Waiting on Firstmate', tone: 'quiet', when: null };
	if (t.status === 'with-reviewers')
		return { text: 'Waiting on reviewers', tone: 'quiet', when: null };
	if (t.status === 'working')
		return { text: 'Crewmate working', tone: 'working', when: since(t.activity?.at) };
	return { text: t.statusLabel, tone: 'quiet', when: null };
}

const ROUTINE = /^(Waiting on .+|Not started yet|Merged .+ ago|Done on .+)\.?$/;

/** A card's one line on where the work stands, or null when it would only repeat its footer. */
export function cardOutcome(t: TaskSummary, column: BoardColumn): string | null {
	if (column === 'landed') return null;
	const line = (column === 'you' ? t.attention?.text : null) ?? t.summary;
	return line && !ROUTINE.test(line.trim()) ? line : null;
}

/**
 * How far a task has sailed, 0 at the start to 1 at the finish: its column's place on
 * the course, nudged on by its step through its passage while it is under way.
 */
export function progress(t: TaskSummary, column: BoardColumn): number {
	if (column === 'landed') return 1;
	if (column === 'queued') return 0;
	const steps = t.passage.steps.length;
	return steps > 1 ? Math.min(t.passage.current / (steps - 1), 1) : 0.5;
}

/** How many vessels a column of a lane's course shows before the rest fold into "+n". */
export const COURSE_CAP = 3;

export interface Vessel {
	task: TaskSummary;
	tone: CardTone;
	/** Where it sits across its column, 0 to 100. */
	x: number;
}

export interface CourseLeg {
	column: BoardColumn;
	vessels: Vessel[];
	/** The least advanced vessels a crowded column folds away: where the "+n" sits and how many. */
	more: { x: number; count: number } | null;
}

export interface Course {
	legs: CourseLeg[];
	/** How far the lane's open work has got: the leg and the place in it where its wake ends. */
	reach: { leg: number; x: number } | null;
}

/**
 * A lane as a race: a leg of the course per shown column, each task a vessel in its
 * column's leg, the furthest on to the right, so the lane reads as ships making for the
 * finish (Landed). The wake runs to the furthest open vessel.
 */
export function course(lane: BoardLane, columns: readonly BoardColumn[], now: number): Course {
	let reach: Course['reach'] = null;
	const legs = columns.map((column, i): CourseLeg => {
		const tasks = [...lane.cells[column]].sort((a, b) => progress(a, column) - progress(b, column));
		const folded = Math.max(tasks.length - COURSE_CAP, 0);
		const slots = tasks.length - folded + (folded ? 1 : 0);
		const at = (k: number) => ((k + 1) / (slots + 1)) * 100;
		const vessels = tasks.slice(folded).map((task, k) => ({
			task,
			tone: cardWait(task, column, now).tone,
			x: at(k + (folded ? 1 : 0))
		}));
		if (vessels.length && column !== 'landed') reach = { leg: i, x: vessels.at(-1)!.x };
		return { column, vessels, more: folded ? { x: at(0), count: folded } : null };
	});
	return { legs, reach };
}
