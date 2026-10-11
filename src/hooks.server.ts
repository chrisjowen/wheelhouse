import type { Handle, ServerInit } from '@sveltejs/kit';
import { getRuntime } from '$lib/server/runtime';

// Start the shared collector as soon as the server boots, not on the first request.
export const init: ServerInit = async () => {
	await getRuntime();
};

const LOOPBACK_HOST = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i;

// Wheelhouse only listens on loopback; any other Host means a DNS-rebinding page.
export const handle: Handle = ({ event, resolve }) => {
	if (!LOOPBACK_HOST.test(event.request.headers.get('host') ?? '')) {
		return new Response('Misdirected request', { status: 421 });
	}
	return resolve(event);
};
