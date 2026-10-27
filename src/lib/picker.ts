import type { Project, TaskSummary } from '$lib/types';
import { projectStats, type ProjectStats } from '$lib/views';

/**
 * The project picker in the left panel and the header: with many projects, neither
 * lists them all. Pinned projects come first, then the most active (top) ones, up to a
 * small number in all; a search finds any other, and "Show all" lists the rest.
 */

/** How many projects the panel shows before "Show all": pinned and top together. */
export const PICKER_LIMIT = 6;

export interface PickerSections {
	/** The captain's pins, in project order. */
	pinned: Project[];
	/** The most active of the others, filling up to the limit. */
	top: Project[];
	/** Everything else, by name. */
	rest: Project[];
}

/** Most active first: waiting on the captain, then work under way, then the latest activity. */
export function byActivity(a: ProjectStats, b: ProjectStats): number {
	return (
		b.needsYou - a.needsYou ||
		b.underWay - a.underWay ||
		(b.lastActivity ?? 0) - (a.lastActivity ?? 0) ||
		b.queued - a.queued
	);
}

/** Each project's stats, from the fleet's tasks. */
export function statsByProject(
	projects: Project[],
	tasks: TaskSummary[],
	now: number
): Map<string, ProjectStats> {
	const by = new Map<string, TaskSummary[]>(projects.map((p) => [p.id, []]));
	for (const t of tasks) by.get(t.projectId)?.push(t);
	return new Map(projects.map((p) => [p.id, projectStats(by.get(p.id) ?? [], now)]));
}

const byName = (a: Project, b: Project) =>
	a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });

/**
 * Splits the projects into pinned, top and the rest. Top fills what the pins leave
 * of `limit`, most active first (then by name, so a quiet fleet still shows a few);
 * the current project always shows, among the top ones, so the panel never hides
 * where you are.
 */
export function pickerSections(
	projects: Project[],
	stats: Map<string, ProjectStats>,
	opts: { pinned: readonly string[]; current?: string | null; limit?: number }
): PickerSections {
	const limit = opts.limit ?? PICKER_LIMIT;
	const pins = new Set(opts.pinned);
	const pinned = projects.filter((p) => pins.has(p.id));
	const none: ProjectStats = { underWay: 0, needsYou: 0, landed: 0, queued: 0, lastActivity: null };
	const st = (p: Project) => stats.get(p.id) ?? none;
	const others = projects
		.filter((p) => !pins.has(p.id))
		.toSorted((a, b) => byActivity(st(a), st(b)) || byName(a, b));
	const top = others.slice(0, Math.max(0, limit - pinned.length));
	const cur = opts.current ? others.find((p) => p.id === opts.current) : undefined;
	if (cur && !top.includes(cur)) top.push(cur);
	const shown = new Set(top.map((p) => p.id));
	return { pinned, top, rest: others.filter((p) => !shown.has(p.id)).toSorted(byName) };
}

/**
 * Projects matching a search, best first: a name that starts with it, then a word in
 * the name that does, then any match in the name or id. Pinned ones lead each group.
 */
export function matchProjects(
	projects: Project[],
	query: string,
	pinned: readonly string[] = []
): Project[] {
	const q = query.trim().toLowerCase();
	if (!q) return projects.toSorted(byName);
	const pins = new Set(pinned);
	const rank = (p: Project) => {
		const name = p.name.toLowerCase();
		if (name.startsWith(q)) return 0;
		if (name.split(/[\s\-_.:/]+/).some((w) => w.startsWith(q))) return 1;
		if (name.includes(q) || p.id.toLowerCase().includes(q)) return 2;
		return -1;
	};
	return projects
		.map((p) => ({ p, r: rank(p) }))
		.filter((x) => x.r >= 0)
		.toSorted(
			(a, b) => a.r - b.r || Number(pins.has(b.p.id)) - Number(pins.has(a.p.id)) || byName(a.p, b.p)
		)
		.map((x) => x.p);
}

/** Pins as stored: a list of distinct project ids, anything else dropped. */
export function parsePins(raw: string | null): string[] {
	try {
		const v: unknown = raw ? JSON.parse(raw) : [];
		return Array.isArray(v)
			? [...new Set(v.filter((x): x is string => typeof x === 'string'))]
			: [];
	} catch {
		return [];
	}
}
