import type { Project } from '$lib/types';

/**
 * How a project reads in the picker when names run long. Projects whose names share a
 * leading segment (split on `-`, `_` or `/`) with at least one other project form a
 * group: `ai-innovations-chat-agent` and `ai-innovations-workflow` sit under
 * "ai-innovations" as "chat-agent" and "workflow". A friendly name, kept per browser,
 * overrides the label. The monogram comes from the part that tells siblings apart.
 */

export interface ProjectLabel {
	/** The shared prefix this project is grouped under (null when ungrouped). */
	group: string | null;
	/** What the row shows: the friendly name, else the name without the group prefix. */
	label: string;
	/** The full registered name, for tooltips and search. */
	full: string;
	/** Two letters from the distinguishing part, e.g. "CA" for chat-agent. */
	monogram: string;
	/** One of a few quiet hues, picked from the name, so siblings look different. */
	hue: number;
}

const SEP = /([-_/])/;

/** A name's segments and the separators between them: `a-b_c` → ['a','-','b','_','c']. */
function parts(name: string): string[] {
	return name.split(SEP).filter((s) => s !== '');
}

/**
 * The group prefix for each project: the longest run of leading segments it shares
 * with at least one other project, leaving something of its own after it. A prefix
 * only one project ends up with is dropped, so the project stays ungrouped.
 */
export function projectGroups(
	projects: readonly Pick<Project, 'id' | 'name'>[]
): Map<string, string> {
	const split = projects.map((p) => ({ id: p.id, parts: parts(p.name) }));
	// Every candidate prefix (ending on a segment, never the whole name), counted.
	const count = new Map<string, number>();
	const prefixes = (ps: string[]) => {
		const out: string[] = [];
		for (let i = 1; i < ps.length - 1; i += 2) out.push(ps.slice(0, i).join(''));
		return out;
	};
	for (const p of split)
		for (const pre of prefixes(p.parts)) count.set(pre, (count.get(pre) ?? 0) + 1);
	const chosen = new Map<string, string>();
	for (const p of split) {
		const best = prefixes(p.parts)
			.filter((pre) => (count.get(pre) ?? 0) >= 2)
			.at(-1);
		if (best) chosen.set(p.id, best);
	}
	// Drop a group only one project chose (its siblings took a longer prefix).
	const size = new Map<string, number>();
	for (const g of chosen.values()) size.set(g, (size.get(g) ?? 0) + 1);
	for (const [id, g] of chosen) if ((size.get(g) ?? 0) < 2) chosen.delete(id);
	return chosen;
}

/** Two letters: the initials of the first two words, else the first two letters. */
export function monogram(text: string): string {
	const words = text
		.trim()
		.split(/[\s\-_/.:]+/)
		.filter(Boolean);
	if (!words.length) return '?';
	if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
	return (words[0][0] + words[1][0]).toUpperCase();
}

/** How many quiet hues the monogram tiles cycle through (see `.project-tile[data-hue]`). */
export const HUES = 6;

export function hue(text: string): number {
	let h = 0;
	for (const c of text) h = (h * 31 + c.charCodeAt(0)) >>> 0;
	return h % HUES;
}

/** Each project's label, from its group prefix and any friendly name. */
export function projectLabels(
	projects: readonly Pick<Project, 'id' | 'name'>[],
	aliases: Readonly<Record<string, string>> = {}
): Map<string, ProjectLabel> {
	const groups = projectGroups(projects);
	return new Map(
		projects.map((p) => {
			const group = groups.get(p.id) ?? null;
			const rest = group ? p.name.slice(group.length).replace(/^[-_/]+/, '') : p.name;
			const alias = aliases[p.id]?.trim();
			const label = alias || rest;
			return [p.id, { group, label, full: p.name, monogram: monogram(label), hue: hue(p.name) }];
		})
	);
}

/** One run of rows: under a group heading when two or more siblings sit together. */
export type LabelRun<T> = { group: string | null; items: T[] };

/**
 * Gathers a list's siblings under their group, in order of each group's first
 * appearance; a project alone in its group in this list stays a plain row.
 */
export function runs<T extends { id: string }>(
	items: readonly T[],
	labels: Map<string, ProjectLabel>
): LabelRun<T>[] {
	const out: LabelRun<T>[] = [];
	const at = new Map<string, LabelRun<T>>();
	const n = new Map<string, number>();
	for (const it of items) {
		const g = labels.get(it.id)?.group;
		if (g) n.set(g, (n.get(g) ?? 0) + 1);
	}
	for (const it of items) {
		const g = labels.get(it.id)?.group ?? null;
		if (g && (n.get(g) ?? 0) >= 2) {
			let r = at.get(g);
			if (!r) {
				r = { group: g, items: [] };
				at.set(g, r);
				out.push(r);
			}
			r.items.push(it);
		} else out.push({ group: null, items: [it] });
	}
	return out;
}

/** Friendly names as stored: an object of project id → name, anything else dropped. */
export function parseAliases(raw: string | null): Record<string, string> {
	try {
		const v: unknown = raw ? JSON.parse(raw) : {};
		if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
		return Object.fromEntries(
			Object.entries(v).filter(
				(e): e is [string, string] => typeof e[1] === 'string' && e[1].trim() !== ''
			)
		);
	} catch {
		return {};
	}
}
