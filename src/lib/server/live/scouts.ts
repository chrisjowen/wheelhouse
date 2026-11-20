import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type { TaskSummary } from '$lib/types';
import { isScoutFor, reportSummary, SCOUT_REF } from '$lib/live/scout';

/**
 * Finding the scouts a Live mode discussion asked Firstmate for, using only
 * what Firstmate writes for any task: the fleet, each task's brief
 * (data/<id>/brief.md) and a scout's report (data/<id>/report.md). A scout is
 * the task with the id Wheelhouse asked for, or whose brief carries the
 * reference; only briefs written since the request are read.
 */

export interface ScoutLookup {
	ref: string;
	/** When the request was sent, in epoch milliseconds. */
	since: number;
}

export interface ScoutFound {
	task: string;
	title: string;
	statusLabel: string;
	status: string;
	/** Once the report is written: its gist, and the report itself (clipped) for the crew. */
	report: { summary: string; text: string } | null;
}

const OWN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
/** A brief written a little before the request (clock skew, a slow send) still counts. */
const SKEW_MS = 2 * 60_000;

async function freshBrief(home: string, id: string, since: number): Promise<string | null> {
	const file = path.join(home, 'data', id, 'brief.md');
	try {
		if ((await stat(file)).mtimeMs < since - SKEW_MS) return null;
		return (await readFile(file, 'utf8')).slice(0, 64 * 1024);
	} catch {
		return null;
	}
}

export async function findScouts(
	home: string,
	tasks: TaskSummary[],
	lookups: ScoutLookup[]
): Promise<Record<string, ScoutFound | null>> {
	const out: Record<string, ScoutFound | null> = {};
	const own = tasks.filter((t) => OWN_ID.test(t.id));
	const briefs = new Map<string, string | null>();
	const valid = lookups.filter((l) => SCOUT_REF.test(l.ref));
	const earliest = Math.min(...valid.map((l) => l.since));
	for (const { ref } of valid) {
		let task = own.find((t) => isScoutFor(ref, t.id, null)) ?? null;
		if (!task)
			for (const t of own) {
				if (!briefs.has(t.id)) briefs.set(t.id, await freshBrief(home, t.id, earliest));
				if (isScoutFor(ref, t.id, briefs.get(t.id) ?? null)) {
					task = t;
					break;
				}
			}
		if (!task) {
			out[ref] = null;
			continue;
		}
		const text = await readFile(path.join(home, 'data', task.id, 'report.md'), 'utf8').catch(
			() => null
		);
		out[ref] = {
			task: task.id,
			title: task.shortTitle || task.title,
			statusLabel: task.statusLabel,
			status: task.status,
			report: text?.trim()
				? { summary: reportSummary(text), text: text.trim().slice(0, 12_000) }
				: null
		};
	}
	return out;
}
