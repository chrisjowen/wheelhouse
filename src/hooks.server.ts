import { json, type Handle, type ServerInit } from '@sveltejs/kit';
import { getRuntime } from '$lib/server/runtime';
import { cleanUploads, uploadsDir } from '$lib/server/uploads';
import { isMutating, LOOPBACK_HOST, refuseMutation, servedOrigin } from '$lib/server/session';

// Start the shared collector as soon as the server boots, not on the first request,
// and delete chat attachments past their keeping time.
export const init: ServerInit = async () => {
	void cleanUploads(uploadsDir(process.env));
	await getRuntime();
};

// Wheelhouse only listens on loopback; any other Host means a DNS-rebinding page.
// Anything that changes state must also come from the served origin with this
// launch's session token (see lib/server/session.ts).
export const handle: Handle = ({ event, resolve }) => {
	const host = event.request.headers.get('host') ?? '';
	if (!LOOPBACK_HOST.test(host)) {
		return new Response('Misdirected request', { status: 421 });
	}
	if (isMutating(event.request.method)) {
		const refused = refuseMutation(event.request, servedOrigin(event.request));
		if (refused) return json({ message: refused }, { status: 403 });
	}
	return resolve(event);
};
