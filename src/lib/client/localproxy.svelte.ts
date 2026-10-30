import { proxiedUrl } from '$lib/localproxy';

/**
 * The localhost proxy in the browser: whether it is on (the root layout's
 * data, refreshed whenever a page reloads it), and every address on
 * Wheelhouse's computer shown through it while it is (see lib/localproxy.ts).
 */
class LocalProxyState {
	on = $state(false);

	/** `raw` as this page should open or embed it. */
	view(raw: string): string {
		return this.on ? proxiedUrl(raw, location) : raw;
	}
}

export const localProxy = new LocalProxyState();

/**
 * Send every link on the page to an address on Wheelhouse's computer through
 * the proxy, wherever it is drawn (the chat, status notes, decision cards,
 * plugin panels): its href is rewritten just before the browser follows it,
 * by a click, a middle click, the context menu or a drag. The text shown is
 * left as the crew wrote it. Returns the function that stops it.
 */
export function proxyLinks(root: Document): () => void {
	const rewrite = (e: Event) => {
		if (!localProxy.on) return;
		// The path reaches into a plugin element's open shadow root, which the target hides.
		const a = e
			.composedPath()
			.find(
				(n): n is HTMLAnchorElement => n instanceof HTMLAnchorElement && n.hasAttribute('href')
			);
		if (!a) return;
		const to = localProxy.view(a.href);
		if (to !== a.href) a.href = to;
	};
	const events = ['click', 'auxclick', 'contextmenu', 'dragstart'] as const;
	for (const type of events) root.addEventListener(type, rewrite, true);
	return () => {
		for (const type of events) root.removeEventListener(type, rewrite, true);
	};
}
