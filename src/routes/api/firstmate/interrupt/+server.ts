import { json } from '@sveltejs/kit';
import { getRuntime } from '$lib/server/runtime';
import { NO_STORE } from '$lib/server/http';
import type { RequestHandler } from './$types';

/** Press Escape in the Firstmate session, which stops what it is doing. Guarded in hooks.server.ts. */
export const POST: RequestHandler = async () => {
	const runtime = await getRuntime();
	if (!runtime.configured)
		return json({ message: runtime.error }, { status: 503, headers: NO_STORE });
	const r = await runtime.firstmate.interrupt();
	if (!r.ok) return json({ message: r.error }, { status: r.status, headers: NO_STORE });
	return json({ interrupted: true }, { headers: NO_STORE });
};
