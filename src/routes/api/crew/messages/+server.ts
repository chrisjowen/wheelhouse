import { json } from '@sveltejs/kit';
import { getRuntime } from '$lib/server/runtime';
import { NO_STORE, readJson } from '$lib/server/http';
import type { RequestHandler } from './$types';

/**
 * Send the captain's message to a worker in an open discussion:
 * `{ taskId, kind: say|status|pause|resume, text? }` with an Idempotency-Key
 * header. It goes into the task's steering inbox through fm-send.sh, marked as
 * the captain's own (lib/crew.ts), and Firstmate is handed a note of it.
 * Repeating the same key returns the message (sending it again only when it
 * failed). 201 when sent, 200 for a repeat, 502 when fm-send.sh refused it.
 * Guarded in hooks.server.ts.
 */
export const POST: RequestHandler = async ({ request }) => {
	const runtime = await getRuntime();
	if (!runtime.configured)
		return json({ message: runtime.error }, { status: 503, headers: NO_STORE });
	const read = await readJson(request, 64 * 1024);
	if (!read.ok) return read.response;
	const { taskId, kind, text } = read.body;
	if (typeof taskId !== 'string')
		return json({ message: 'Name the task.' }, { status: 400, headers: NO_STORE });
	const id = request.headers.get('idempotency-key');
	const before = runtime.crew.view().discussions.find((d) => d.taskId === taskId);
	const known = !!before?.messages.some((m) => m.id === id && m.delivery !== 'failed');
	const r = await runtime.crew.send(taskId, id, kind, text);
	if (!r.ok) return json({ message: r.error }, { status: r.status, headers: NO_STORE });
	if (r.value.delivery === 'failed')
		return json(
			{ message: r.value.error ?? 'The message could not be delivered.', sent: r.value },
			{ status: 502, headers: NO_STORE }
		);
	return json({ sent: r.value }, { status: known ? 200 : 201, headers: NO_STORE });
};
