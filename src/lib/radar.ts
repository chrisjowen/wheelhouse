import { isTrouble, landedAt, LANDED_RECENT_MS, needsYou } from '$lib/harbour';
import type { TaskSummary } from '$lib/types';

/**
 * The fleet radar: every task is a dot in one of five lanes, from Queued to
 * Landed, coloured by what it is waiting on. Pure, so it is unit-tested; the
 * Radar view (RadarBoard.svelte) draws it and animates the moves between lanes.
 */

export type Lane = 'queued' | 'building' | 'testing' | 'pr' | 'landed';

export const LANES: readonly { key: Lane; label: string; hint: string }[] = [
	{ key: 'queued', label: 'Queued', hint: 'Waiting its turn' },
	{ key: 'building', label: 'Building', hint: 'The crew is writing it' },
	{ key: 'testing', label: 'Testing', hint: 'Checks and review' },
	{ key: 'pr', label: 'Pull request', hint: 'In CI or with you' },
	{ key: 'landed', label: 'Landed', hint: 'In the last day' }
];

/** Built-in passage columns (scout steps share them) and the lane each sits in. */
const COLUMN_LANE: Record<string, Lane> = {
	queued: 'queued',
	building: 'building',
	checks: 'testing',
	pr: 'pr',
	review: 'pr',
	landed: 'landed'
};

/**
 * The lane a task is in: its current passage step's column. A step a passage
 * file added (such as Deployed after Landed) sits in the lane of the nearest
 * built-in step before it.
 */
export function laneOf(t: TaskSummary): Lane {
	if (t.status === 'queued') return 'queued';
	if (t.status === 'landed') return 'landed';
	const steps = t.passage.steps;
	for (let i = Math.min(t.passage.current, steps.length - 1); i >= 0; i--) {
		const lane = COLUMN_LANE[steps[i].column] ?? COLUMN_LANE[steps[i].key];
		if (lane) return lane;
	}
	return 'building';
}

/**
 * What a dot shows:
 *   you        amber: waiting on the captain (a review or a decision)
 *   stuck      red: blocked, failed, out of contact, or its step failed
 *   firstmate  a decision a worker raised that Firstmate is handling
 *   busy       pulsing: the worker is working right now
 *   idle       under way but not busy (paused, done and waiting, between reads)
 *   landed     merged or finished
 */
export type Signal = 'you' | 'stuck' | 'firstmate' | 'busy' | 'idle' | 'landed';

export const SIGNAL_LABEL: Record<Signal, string> = {
	you: 'Waiting on you',
	stuck: 'Stuck',
	firstmate: 'With Firstmate',
	busy: 'Busy',
	idle: 'Idle',
	landed: 'Landed'
};

export function signalOf(t: TaskSummary): Signal {
	if (t.status === 'landed') return 'landed';
	if (needsYou(t)) return 'you';
	if (
		isTrouble(t) ||
		t.passage.steps[t.passage.current]?.failed ||
		t.pipeline?.outcome === 'failed'
	)
		return 'stuck';
	if (t.status === 'with-firstmate') return 'firstmate';
	if (t.busy) return 'busy';
	return 'idle';
}

const SIGNAL_ORDER: Record<Signal, number> = {
	you: 0,
	stuck: 1,
	firstmate: 2,
	busy: 3,
	idle: 4,
	landed: 5
};

const ms = (iso: string | null | undefined) => {
	const t = iso ? Date.parse(iso) : NaN;
	return Number.isNaN(t) ? null : t;
};

/**
 * When the task reached its lane, as Firstmate's records tell it (epoch ms, or
 * null when nothing says): when it landed, when its validation step started,
 * else its latest reported activity, else when it started. The view replaces
 * this with the moment it saw a dot move, when it did.
 */
export function laneSince(t: TaskSummary, lane: Lane = laneOf(t)): number | null {
	if (lane === 'landed') return landedAt(t);
	const activity = t.activity?.source === 'state' ? null : ms(t.activity?.at);
	if (lane === 'testing') return ms(t.pipeline?.startedAt) ?? activity ?? ms(t.since);
	if (lane === 'queued') return ms(t.since);
	return activity ?? ms(t.since);
}

/** Landed dots stay bright for an hour, then fade until they leave after a day. */
export const LANDED_BRIGHT_MS = 3600 * 1000;
export const LANDED_FAINTEST = 0.35;

export function landedFade(at: number | null, now: number): number {
	if (at === null) return LANDED_FAINTEST;
	const age = now - at;
	if (age <= LANDED_BRIGHT_MS) return 1;
	const k = Math.min(1, (age - LANDED_BRIGHT_MS) / (LANDED_RECENT_MS - LANDED_BRIGHT_MS));
	return 1 - (1 - LANDED_FAINTEST) * k;
}

export interface Blip {
	id: string;
	task: TaskSummary;
	lane: Lane;
	signal: Signal;
	/** When it reached its lane, from Firstmate's records (epoch ms). */
	since: number | null;
	/** 0..1: landed dots fade as they age. */
	opacity: number;
}

export interface Radar {
	lanes: { key: Lane; label: string; hint: string; blips: Blip[] }[];
	/** Landed longer ago than a day, so no longer drawn. */
	landedOlder: number;
	/** How many dots show each signal. */
	counts: Record<Signal, number>;
}

/** The radar for a set of tasks: each lane's dots, most pressing first, then longest in the lane. */
export function radar(tasks: TaskSummary[], now: number): Radar {
	const byLane = new Map<Lane, Blip[]>(LANES.map((l) => [l.key, []]));
	const counts: Record<Signal, number> = {
		you: 0,
		stuck: 0,
		firstmate: 0,
		busy: 0,
		idle: 0,
		landed: 0
	};
	let landedOlder = 0;
	for (const t of tasks) {
		const lane = laneOf(t);
		const since = laneSince(t, lane);
		const signal = signalOf(t);
		if (t.status === 'landed') {
			if (since === null || now - since > LANDED_RECENT_MS) {
				landedOlder++;
				continue;
			}
		}
		counts[signal]++;
		byLane.get(lane)!.push({
			id: t.id,
			task: t,
			lane,
			signal,
			since,
			opacity: signal === 'landed' ? landedFade(since, now) : 1
		});
	}
	const order = (a: Blip, b: Blip) =>
		a.lane === 'landed'
			? (b.since ?? 0) - (a.since ?? 0)
			: SIGNAL_ORDER[a.signal] - SIGNAL_ORDER[b.signal] ||
				(a.since ?? Infinity) - (b.since ?? Infinity) ||
				a.id.localeCompare(b.id);
	return {
		lanes: LANES.map((l) => ({ ...l, blips: byLane.get(l.key)!.sort(order) })),
		landedOlder,
		counts
	};
}

export interface Move {
	id: string;
	title: string;
	from: Lane | null;
	to: Lane;
	at: number;
}

/** The dots that changed lane between two reads; new dots count as moves only once a read came before. */
export function moves(prev: Map<string, Lane> | null, next: Radar, at: number): Move[] {
	if (!prev) return [];
	const out: Move[] = [];
	for (const lane of next.lanes) {
		for (const b of lane.blips) {
			const was = prev.get(b.id) ?? null;
			if (was !== b.lane)
				out.push({ id: b.id, title: b.task.shortTitle, from: was, to: b.lane, at });
		}
	}
	return out;
}

/** Each drawn dot's lane, for the next read's moves. */
export const laneMap = (r: Radar) =>
	new Map(r.lanes.flatMap((l) => l.blips.map((b) => [b.id, b.lane] as const)));

export const laneLabel = (lane: Lane) => LANES.find((l) => l.key === lane)!.label;

/** How long a dot has been in its lane, in a few words: "4 min", "2 h", "3 days". */
export function stay(since: number | null, now: number): string {
	if (since === null) return 'unknown';
	const m = Math.max(0, Math.round((now - since) / 60_000));
	if (m < 1) return 'under a minute';
	if (m < 60) return `${m} min`;
	const h = Math.round(m / 60);
	if (h < 48) return `${h} h`;
	return `${Math.round(h / 24)} days`;
}
