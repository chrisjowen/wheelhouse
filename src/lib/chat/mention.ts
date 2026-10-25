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
