import { json } from '@sveltejs/kit';
import { getRuntime } from '$lib/server/runtime';
import { NO_STORE, readJson } from '$lib/server/http';
import { INPUT_MAX_BYTES } from '$lib/server/sessions/firstmate';
import type { RequestHandler } from './$types';

/**
 * Type `{ text }` into the Firstmate session and submit it, as the captain
 * would at its prompt (references are already expanded by the page). Only the
 * session Wheelhouse runs takes input. Origin and session token are checked in
 * hooks.server.ts.
 */
export const POST: RequestHandler = async ({ request }) => {
	const runtime = await getRuntime();
	if (!runtime.configured)
		return json({ message: runtime.error }, { status: 503, headers: NO_STORE });
	const read = await readJson(request, INPUT_MAX_BYTES * 2);
	if (!read.ok) return read.response;
	if (typeof read.body.text !== 'string') {
		return json({ message: 'The message is not valid.' }, { status: 400, headers: NO_STORE });
	}
	const r = await runtime.firstmate.send(read.body.text);
	if (!r.ok) return json({ message: r.error }, { status: r.status, headers: NO_STORE });
	void runtime.chat.refresh();
	setTimeout(() => void runtime.chat.refresh(), 800);
	return json({ sent: true }, { headers: NO_STORE });
};
