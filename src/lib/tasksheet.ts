/**
 * A task opens in a side panel over the page it was clicked on (TaskSheet),
 * instead of taking the captain away to its page. Its id is in the address
 * (`?task=<id>`), so Back closes the panel and a reload or a shared link opens
 * it again. A link to a task's page with nothing after it opens the panel;
 * one to a tab of the page (`?tab=`), a document, another window, or anything
 * marked `data-full-page` (the panel's own Open full page) still goes there.
 */

/** The address's parameter that holds the task open in the side panel. */
export const SHEET_PARAM = 'task';

/** The task a link to `href` opens in the side panel, or null when the link goes where it says. */
export function sheetTaskFor(href: string, here: URL): string | null {
	let url: URL;
	try {
		url = new URL(href, here);
	} catch {
		return null;
	}
	if (url.origin !== here.origin || url.search || url.hash) return null;
	const m = /^\/tasks\/([^/]+)\/?$/.exec(url.pathname);
	// On the task's own page the link goes nowhere new.
	if (!m || url.pathname.replace(/\/$/, '') === here.pathname.replace(/\/$/, '')) return null;
	try {
		return decodeURIComponent(m[1]);
	} catch {
		return null;
	}
}

type Click = Pick<
	MouseEvent,
	'defaultPrevented' | 'button' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'target'
>;

/** The task a plain click opens in the side panel, or null to let the browser follow it. */
export function clickedTask(e: Click, here: URL): string | null {
	if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)
		return null;
	const a = (e.target as Element | null)?.closest?.('a[href]');
	if (!a || a.namespaceURI !== 'http://www.w3.org/1999/xhtml') return null;
	const link = a as HTMLAnchorElement;
	if ((link.target && link.target !== '_self') || link.hasAttribute('download')) return null;
	if (link.closest('[data-full-page]')) return null;
	return sheetTaskFor(link.getAttribute('href') ?? '', here);
}
