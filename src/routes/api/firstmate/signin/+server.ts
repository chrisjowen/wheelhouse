import { json } from '@sveltejs/kit';
import { getRuntime } from '$lib/server/runtime';
import { NO_STORE, readJson } from '$lib/server/http';
import type { RequestHandler } from './$types';

/**
 * Type the code the captain brought back from a harness's sign-in page into
 * its sign-in field in the Firstmate session, and submit it:
 * `{ signature, code }`. `signature` is the sign-in the page showed; nothing
 * is typed into a different screen. Guarded in hooks.server.ts.
 */
export const POST: RequestHandler = async ({ request }) => {
	const runtime = await getRuntime();
	if (!runtime.configured) {
		return json({ message: runtime.error }, { status: 503, headers: NO_STORE });
	}
	const read = await readJson(request, 16 * 1024);
	if (!read.ok) return read.response;
	const { signature, code } = read.body;
	if (typeof signature !== 'string' || typeof code !== 'string') {
		return json({ message: 'The code is not valid.' }, { status: 400, headers: NO_STORE });
	}
	const r = await runtime.firstmate.signIn(signature, code);
	if (!r.ok) return json({ message: r.error }, { status: r.status, headers: NO_STORE });
	void runtime.chat.refresh();
	setTimeout(() => void runtime.chat.refresh(), 700);
	return json({ typed: true }, { headers: NO_STORE });
};
