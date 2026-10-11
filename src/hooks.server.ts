import { json, type Handle, type ServerInit } from '@sveltejs/kit';
import { getRuntime } from '$lib/server/runtime';
import { isMutating, refuseMutation } from '$lib/server/session';

// Start the shared collector as soon as the server boots, not on the first request.
export const init: ServerInit = async () => {
	await getRuntime();
};

const LOOPBACK_HOST = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i;

// Wheelhouse only listens on loopback; any other Host means a DNS-rebinding page.
// Anything that changes state must also come from the served origin with this
// launch's session token (see lib/server/session.ts).
export const handle: Handle = ({ event, resolve }) => {
	const host = event.request.headers.get('host') ?? '';
	if (!LOOPBACK_HOST.test(host)) {
		return new Response('Misdirected request', { status: 421 });
	}
	if (isMutating(event.request.method)) {
		// Wheelhouse serves plain HTTP on loopback, so the page's origin is http://<Host>.
		// (event.url.origin is not used: adapter-node assumes https without ORIGIN set.)
		const refused = refuseMutation(event.request, `http://${host.toLowerCase()}`);
		if (refused) return json({ message: refused }, { status: 403 });
	}
	return resolve(event);
};
