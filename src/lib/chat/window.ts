/**
 * Keeping a long-open chat light: the page draws only its latest messages (a
 * window over the chat's items), reaching further back as the captain scrolls
 * up, and the work that reads the fleet's tasks against every message is done
 * again only when something it reads of them changes. Pure, so it is
 * unit-tested; Chat.svelte holds the state.
 */
import type { TaskSummary } from '../types';
import type { Item } from './fold';

/** The most messages the chat draws while the captain is at the latest. */
export const WINDOW_ITEMS = 120;
/** How many more it draws each time the captain reaches the top of what is drawn. */
export const WINDOW_STEP = 80;

/**
 * Where the drawn window starts: at `from` (an item's id) while the captain
 * reads back, else (or once that item is gone) the last `size` items.
 */
export function windowStart(
	items: readonly Pick<Item, 'id'>[],
	from: string | null,
	size = WINDOW_ITEMS
): number {
	if (from !== null) {
		const i = items.findIndex((it) => it.id === from);
		if (i >= 0) return i;
	}
	return Math.max(0, items.length - size);
}

/** The item that draws a bubble (a message's own id, or a reply part's, with `#n` for a section). */
export function itemOf(items: readonly Item[], bubble: string): number {
	return items.findIndex(
		(it) =>
			it.id === bubble ||
			(it.kind === 'turn' && it.parts.some((p) => p.id === bubble || bubble.startsWith(`${p.id}#`)))
	);
}

/** What tagging the chat reads of a task: its id, project, and the addresses that name it. */
export const tagKey = (tasks: readonly TaskSummary[]): string =>
	tasks
		.map(
			(t) =>
				`${t.id}\u0000${t.projectId ?? ''}\u0000${t.secondMate ? 1 : 0}\u0000${t.pr?.url ?? ''}\u0000${t.preview?.url ?? ''}\u0000${t.board?.url ?? ''}`
		)
		.join('\u0001');

/** What placing preview cards reads of a task: what tagging does, and when its preview landed. */
export const previewKey = (tasks: readonly TaskSummary[]): string =>
	`${tagKey(tasks)}\u0002${tasks
		.map(
			(t) =>
				`${t.status}\u0000${t.mergedAt ?? ''}\u0000${t.preview?.reportedAt ?? ''}\u0000${t.board?.reportedAt ?? ''}`
		)
		.join('\u0001')}`;

/**
 * Hands back the value it was last given while `key` of it stays the same, so
 * what is derived from it is not worked out again (a fleet push that changes
 * only a task's progress leaves the chat's tags and cards as they are).
 */
export function sameWhile<T>(key: (v: T) => string): (v: T) => T {
	let last: { k: string; v: T } | null = null;
	return (v) => {
		const k = key(v);
		if (!last || last.k !== k) last = { k, v };
		return last.v;
	};
}

/**
 * Where the chat starts once the captain cleared its view at `clearedAt`: the
 * first item after that time (`items.length` when none is), or 0 when the view
 * was never cleared. The items before it stay held, a "Show earlier messages"
 * away.
 */
export function clearedStart(items: readonly Pick<Item, 'at'>[], clearedAt: string | null): number {
	const t = clearedAt ? Date.parse(clearedAt) : NaN;
	if (!Number.isFinite(t)) return 0;
	const i = items.findIndex((it) => Date.parse(it.at) > t);
	return i < 0 ? items.length : i;
}
