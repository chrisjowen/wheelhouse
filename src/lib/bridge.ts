import { needsYou } from '$lib/harbour';
import type { Project, TaskSummary } from '$lib/types';

/**
 * What the bridge shows at a glance, around the chat: the Firstmate home beside the logo,
 * each second mate as an initials disc in the menu, the rail's checks gauge and Harbour at
 * a glance. Pure, so the components only draw.
 */

/** The Firstmate home's own name, from its path: `/home/me/fm-home/` reads `fm-home`. */
export function homeLabel(home: string | null | undefined): string | null {
	const name = home
		?.replace(/[\\/]+$/, '')
		.split(/[\\/]/)
		.pop()
		?.trim();
	return name || null;
}

/** Up to two initials from an id's words: `east-mate` reads `EM`, `scout` reads `SC`. */
export function initials(id: string): string {
	const words = id.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
	if (!words.length) return '?';
	if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
	return (words[0][0] + words[1][0]).toUpperCase();
}

/** One of six hues for an id, the same id always the same hue. */
export function hueOf(id: string): number {
	let h = 0;
	for (const c of id) h = (h * 31 + c.codePointAt(0)!) >>> 0;
	return h % 6;
}

/** Work in play: neither waiting in the queue nor finished. */
export const inPlay = (t: TaskSummary) =>
	t.status !== 'queued' && t.status !== 'landed' && t.status !== 'closed';

const failing = (t: TaskSummary) =>
	t.status === 'failed' ||
	t.status === 'blocked' ||
	t.status === 'lost' ||
	t.pipeline?.outcome === 'failed' ||
	t.passage.steps.some((s) => s.failed);

/**
 * The checks gauge: how much of the work in play has nothing failing, as a whole
 * percentage (100 with nothing in play), and how many are failing.
 */
export function checksShare(tasks: TaskSummary[]): {
	percent: number;
	failing: number;
	inPlay: number;
} {
	const playing = tasks.filter(inPlay);
	const bad = playing.filter(failing).length;
	return {
		percent: playing.length ? Math.round(((playing.length - bad) / playing.length) * 100) : 100,
		failing: bad,
		inPlay: playing.length
	};
}

export interface GlanceRow {
	id: string;
	name: string;
	/** Whole percent of the project's tasks that have landed. */
	landed: number;
	word: 'Needs you' | 'Working' | 'Quiet';
	tone: 'needs' | 'busy' | 'quiet';
	tasks: number;
}

/**
 * Harbour at a glance: the projects with work, busiest first (at most `limit`), each with
 * its share landed and one word for where it stands.
 */
export function glance(projects: Project[], tasks: TaskSummary[], limit = 4): GlanceRow[] {
	return projects
		.map((p) => {
			const ts = tasks.filter((t) => t.projectId === p.id);
			const needs = ts.some(needsYou);
			const busy = ts.some((t) => t.busy || (inPlay(t) && t.status === 'working'));
			return {
				id: p.id,
				name: p.name,
				landed: ts.length
					? Math.round((ts.filter((t) => t.status === 'landed').length / ts.length) * 100)
					: 0,
				word: needs ? 'Needs you' : busy ? 'Working' : 'Quiet',
				tone: needs ? 'needs' : busy ? 'busy' : 'quiet',
				tasks: ts.length
			} satisfies GlanceRow;
		})
		.filter((r) => r.tasks > 0)
		.sort((a, b) => b.tasks - a.tasks || a.name.localeCompare(b.name))
		.slice(0, limit);
}
