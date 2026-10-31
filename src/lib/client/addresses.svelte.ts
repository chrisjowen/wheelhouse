import { rewriteAddress } from '$lib/plugins/addresses';

/**
 * Address rewrites in the browser: the host template a plugin that is on
 * shows addresses on Wheelhouse's computer at (the root layout's data,
 * refreshed whenever a page reloads it), and every such address shown there
 * while there is one (see lib/plugins/addresses.ts).
 */
class AddressRewrites {
	/** The first active rewrite's host template, such as `{port}.localhost`; null for none. */
	to = $state<string | null>(null);

	/** `raw` as this page should open or embed it. */
	view(raw: string): string {
		return this.to ? rewriteAddress(raw, this.to, location) : raw;
	}
}

export const addressRewrites = new AddressRewrites();

/**
 * Send every link on the page to an address on Wheelhouse's computer through
 * the active rewrite, wherever it is drawn (the chat, status notes, decision
 * cards, plugin panels): its href is rewritten just before the browser follows
 * it, by a click, a middle click, the context menu or a drag. The text shown
 * is left as the crew wrote it. Returns the function that stops it.
 */
export function rewriteLinks(root: Document): () => void {
	const rewrite = (e: Event) => {
		if (!addressRewrites.to) return;
		// The path reaches into a plugin element's open shadow root, which the target hides.
		const a = e
			.composedPath()
			.find(
				(n): n is HTMLAnchorElement => n instanceof HTMLAnchorElement && n.hasAttribute('href')
			);
		if (!a) return;
		const to = addressRewrites.view(a.href);
		if (to !== a.href) a.href = to;
	};
	const events = ['click', 'auxclick', 'contextmenu', 'dragstart'] as const;
	for (const type of events) root.addEventListener(type, rewrite, true);
	return () => {
		for (const type of events) root.removeEventListener(type, rewrite, true);
	};
}
