import type { Ref } from './refs';

/** The parts of the fleet view a `?chat=` mention reads. */
interface Fleet {
	tasks: { id: string; shortTitle: string; projectId: string }[];
	projects: { id: string; name: string }[];
}

/**
 * `/?chat=<task id>` (a task page's "Ask Firstmate about this") starts a
 * message mentioning the task. Returns a reader for the home page: given the
 * page's URL and the current fleet, the task to mention, or null.
 *
 * Each arrival mentions the task once. SvelteKit's replaceState, which drops
 * `?chat=` from the address bar, leaves `page.url` as it was, so the home page
 * keeps seeing it on every live fleet update while the captain types.
 */
export function chatMention(): (url: URL, fleet: Fleet | null) => Ref | null {
	let taken: string | null = null;
	return (url, fleet) => {
		const id = url.searchParams.get('chat');
		if (!id) {
			taken = null;
			return null;
		}
		if (url.href === taken) return null;
		const t = fleet?.tasks.find((x) => x.id === id);
		if (!t) return null;
		taken = url.href;
		return {
			kind: 'task',
			id: t.id,
			title: t.shortTitle,
			project: fleet?.projects.find((p) => p.id === t.projectId)?.name ?? null,
			url: null
		};
	};
}

/**
 * `&draft=<text>` (or `/?draft=` alone) starts the message with some words,
 * e.g. "I'd decide differently" on a decision. Nothing is sent. Taken once per
 * arrival, like the mention. With `?chat=`, it waits for the fleet so the
 * chip and the words arrive together; a task the fleet no longer lists still
 * gets its words, without a chip.
 */
export function chatDraft(): (url: URL, fleet: Fleet | null) => string | null {
	let taken: string | null = null;
	return (url, fleet) => {
		const draft = url.searchParams.get('draft');
		if (!draft) {
			taken = null;
			return null;
		}
		if (url.href === taken) return null;
		if (url.searchParams.get('chat') && !fleet) return null;
		taken = url.href;
		return draft;
	};
}

/**
 * `/?decision=<card id>` (a decision's Chat about this) brings that decision
 * into the chat. Returns a reader for the home page: given the page's URL and
 * its navigation count (from afterNavigate, starting at 1), the card id to
 * bring into view, or null.
 *
 * Each navigation brings it once. `page.url` keeps the parameter after
 * replaceState drops it from the address bar, and SvelteKit keeps the same
 * `page.url` when the address and data are unchanged, so neither the address
 * nor the URL object tells arrivals apart: picking Chat about this again for
 * the same decision on the home page itself (On deck) is a new navigation to
 * the same address and brings it into view again, while the fleet refreshing
 * or the data reloading (no navigation) does not.
 */
export function chatDecision(): (url: URL, navigation: number) => string | null {
	let taken = 0;
	return (url, navigation) => {
		const id = url.searchParams.get('decision');
		if (!id || navigation === taken) return null;
		taken = navigation;
		return id;
	};
}
