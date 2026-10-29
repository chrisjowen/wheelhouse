import { json } from '@sveltejs/kit';
import { getRuntime } from '$lib/server/runtime';
import { NO_STORE } from '$lib/server/http';
import type { RequestHandler } from './$types';

/**
 * Close the Claude Code menu open in the Firstmate session (one a command such
 * as /mcp opened), pressing Escape only while it is on screen. Guarded in
 * hooks.server.ts.
 */
export const POST: RequestHandler = async () => {
	const runtime = await getRuntime();
	if (!runtime.configured)
		return json({ message: runtime.error }, { status: 503, headers: NO_STORE });
	const r = await runtime.firstmate.dismiss();
	if (!r.ok) return json({ message: r.error }, { status: r.status, headers: NO_STORE });
	void runtime.chat.refresh();
	return json({ closed: true }, { headers: NO_STORE });
};
