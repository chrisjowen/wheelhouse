import { json } from '@sveltejs/kit';
import { getRuntime } from '$lib/server/runtime';
import type { RequestHandler } from './$types';

const headers = { 'cache-control': 'no-store' };

/** Re-open the captain's terminal attached to a running session. Guarded in hooks.server.ts. */
export const POST: RequestHandler = async ({ params }) => {
	const runtime = await getRuntime();
	if (!runtime.configured) return json({ message: runtime.error }, { status: 503, headers });
	const r = await runtime.sessions.open(params.id);
	return r.ok
		? json({ opened: true }, { headers })
		: json({ message: r.error }, { status: r.status, headers });
};
