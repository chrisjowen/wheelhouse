import { json } from '@sveltejs/kit';
import { getRuntime } from '$lib/server/runtime';
import { NO_STORE } from '$lib/server/http';
import type { RequestHandler } from './$types';

/**
 * Start the Firstmate session when none is running (never a second one: a
 * session holding Firstmate's lock is left alone). Guarded in hooks.server.ts.
 */
export const POST: RequestHandler = async () => {
	const runtime = await getRuntime();
	if (!runtime.configured)
		return json({ message: runtime.error }, { status: 503, headers: NO_STORE });
	const view = await runtime.firstmate.ensure();
	void runtime.chat.refresh();
	return json(view, { status: view.state === 'unavailable' ? 503 : 200, headers: NO_STORE });
};
