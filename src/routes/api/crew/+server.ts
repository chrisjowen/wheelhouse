import { json } from '@sveltejs/kit';
import { currentCrew, getRuntime } from '$lib/server/runtime';
import { NO_STORE, readJson } from '$lib/server/http';
import type { RequestHandler } from './$types';

/** The open crew discussions, each with what the captain said and its receipts. */
export const GET: RequestHandler = async () => json(await currentCrew(), { headers: NO_STORE });

/**
 * Open a crew discussion on a task, or end one: `{ taskId, action: open|close }`.
 * Opening one already open, or ending one already ended, changes nothing.
 * Guarded in hooks.server.ts.
 */
export const POST: RequestHandler = async ({ request }) => {
	const runtime = await getRuntime();
	if (!runtime.configured)
		return json({ message: runtime.error }, { status: 503, headers: NO_STORE });
	const read = await readJson(request, 4096);
	if (!read.ok) return read.response;
	const { taskId, action } = read.body;
	if (typeof taskId !== 'string' || (action !== 'open' && action !== 'close'))
		return json(
			{ message: 'Name the task and whether to open or close its discussion.' },
			{ status: 400, headers: NO_STORE }
		);
	const r = action === 'open' ? await runtime.crew.open(taskId) : await runtime.crew.close(taskId);
	if (!r.ok) return json({ message: r.error }, { status: r.status, headers: NO_STORE });
	return json(runtime.crew.view(), { headers: NO_STORE });
};
