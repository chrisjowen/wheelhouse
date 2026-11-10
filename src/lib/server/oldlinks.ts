import type { RequestEvent } from '@sveltejs/kit';

/**
 * Where an address from when a task opened in a side panel over the page
 * (`/harbour?task=<id>`) goes now: the task's own page. Only a page opened in
 * the browser; requests to the API and plugins keep their own `?task=`.
 */
export function oldTaskLink(event: Pick<RequestEvent, 'request' | 'url' | 'isDataRequest'>) {
	const { request, url } = event;
	if (request.method !== 'GET' && request.method !== 'HEAD') return null;
	if (event.isDataRequest || !request.headers.get('accept')?.includes('text/html')) return null;
	const id = url.searchParams.get('task');
	if (!id || /^\/(api|plugins|tasks)(\/|$)/.test(url.pathname)) return null;
	return `/tasks/${encodeURIComponent(id)}`;
}
