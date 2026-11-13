import { remoteAddress, type RemoteView } from '$lib/cloud';
import { hostedAddress, type HostedView } from '$lib/hosted';
import { rewriteAddress } from '$lib/plugins/addresses';

/**
 * Address rewrites in the browser, from the root layout's data (refreshed
 * whenever a page reloads it), and every address on Wheelhouse's computer
 * shown there while one applies. First match wins: a page that came through
 * Wheelhouse Cloud opens them on the relay; else, in a hosted dev environment
 * (a configured preview URL pattern, Gitpod or Codespaces, see lib/hosted.ts),
 * at its public URL for their port; else at the host template of a plugin
 * that is on (see lib/plugins/addresses.ts).
 */
class AddressRewrites {
	/** The first active rewrite's host template, such as `{port}.localhost`; null for none. */
	to = $state<string | null>(null);
	/** Set when this page came through Wheelhouse Cloud: addresses on the machine open on the relay instead. */
	remote = $state<RemoteView | null>(null);
	/** Set when Wheelhouse runs in a hosted dev environment: where it serves the ports on its computer. */
	hosted = $state<HostedView | null>(null);

	/** Whether any rewrite applies. */
	get active(): boolean {
		return !!(this.remote || this.hosted || this.to);
	}

	/** `raw` as this page should open or embed it. */
	view(raw: string): string {
		if (this.remote) return remoteAddress(raw, this.remote, location.origin);
		// Wheelhouse's own ports and other addresses stay as they are.
		if (this.hosted) return hostedAddress(raw, this.hosted);
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
		if (!addressRewrites.active) return;
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
