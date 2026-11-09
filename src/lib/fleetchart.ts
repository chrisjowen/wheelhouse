import type { Berth } from '$lib/berths';
import { LANES, radar, type Blip, type Signal } from '$lib/radar';
import type { Project, TaskSummary } from '$lib/types';

/**
 * The Harbour's fleet chart: one quiet row per project with work on it, each
 * task a vessel sitting on its project's line in its radar lane (Queued to
 * Landed), so what is moving across every project shows at a glance. Pure, so
 * it is unit-tested; FleetChart.svelte draws it. Lanes, signals and the order
 * within a lane come from the radar (radar.ts).
 */

/** How many vessels a lane of one row shows before the rest fold into "+n". */
export const PER_LANE = 4;

/** Signals that earn a standing label; the rest are labelled on hover or focus only. */
const CALLS: readonly Signal[] = ['you', 'stuck'];

export interface Vessel {
	blip: Blip;
	/** Where it sits along the row, 0 to 100 (per cent of the lanes' width). */
	x: number;
}

export interface ChartRow {
	project: Project;
	vessels: Vessel[];
	/** Vessels a crowded lane folds away: where the "+n" sits and how many. */
	more: { x: number; count: number }[];
	/** How far the row's open work has got, 0 to 100: the end of its wake. */
	reach: number;
	/** The one vessel labelled without hovering: the most pressing call on the captain. */
	labelled: string | null;
	/** Second mates doing work in this project. */
	mates: NonNullable<TaskSummary['secondMate']>[];
}

export interface FleetChart {
	rows: ChartRow[];
}

const LANE_WIDTH = 100 / LANES.length;

/**
 * The chart for the Harbour's projects, in the berths' order (most pressing
 * first). A project with nothing open and nothing landed in the last day has
 * no row. Within a lane, vessels spread evenly, most pressing first.
 */
export function fleetChart(berths: Berth[], tasks: TaskSummary[], now: number): FleetChart {
	const rows: ChartRow[] = [];
	for (const b of berths) {
		const own = tasks.filter((t) => t.projectId === b.project.id);
		const r = radar(own, now);
		const vessels: Vessel[] = [];
		const more: ChartRow['more'] = [];
		r.lanes.forEach((lane, i) => {
			const shown = lane.blips.slice(0, PER_LANE);
			const folded = lane.blips.length - shown.length;
			const slots = shown.length + (folded ? 1 : 0);
			const at = (k: number) => i * LANE_WIDTH + ((k + 1) / (slots + 1)) * LANE_WIDTH;
			shown.forEach((blip, k) => vessels.push({ blip, x: at(k) }));
			if (folded) more.push({ x: at(shown.length), count: folded });
		});
		if (!vessels.length) continue;
		const open = vessels.filter((v) => v.blip.lane !== 'landed');
		const call = CALLS.flatMap((s) => vessels.filter((v) => v.blip.signal === s))[0];
		const mates = new Map<string, ChartRow['mates'][number]>();
		for (const blip of r.lanes.flatMap((lane) => lane.blips)) {
			const m = blip.task.secondMate;
			if (m) mates.set(m.id, m);
		}
		rows.push({
			project: b.project,
			vessels,
			more,
			reach: open.length ? Math.max(...open.map((v) => v.x)) : 0,
			labelled: call?.blip.id ?? null,
			mates: [...mates.values()]
		});
	}
	return { rows };
}
