import { json } from '@sveltejs/kit';
import { currentMessages, getRuntime } from '$lib/server/runtime';
import { validateSend } from '$lib/server/store/messenger';
import { parseMateTaskId } from '$lib/server/firstmate/matetasks';
import { REQUEST_ID } from '$lib/server/firstmate/adapter';
import type { RequestHandler } from './$types';

const headers = { 'cache-control': 'no-store' };
/** A request body larger than this is refused before it is parsed. */
const MAX_REQUEST_BYTES = 64 * 1024;

/** Messages sent through Wheelhouse, with delivery, acknowledgement and any recorded reply. */
export const GET: RequestHandler = async () => json(await currentMessages(), { headers });

/**
 * Send a message to Firstmate. The Idempotency-Key header is the message's
 * stable request id: repeating a request with the same key returns the
 * original message (200) instead of sending a second one (201 when created).
 * A message Wheelhouse could not confirm yet is answered with 202 and is
 * reconciled in the background with the same request id.
 * Origin and session token are checked in hooks.server.ts.
 */
export const POST: RequestHandler = async ({ request }) => {
	const runtime = await getRuntime();
	if (!runtime.configured) return json({ message: runtime.error }, { status: 503, headers });
	if (!(request.headers.get('content-type') ?? '').includes('application/json')) {
		return json({ message: 'Send the message as JSON.' }, { status: 415, headers });
	}
	const raw = await request.text();
	if (Buffer.byteLength(raw) > MAX_REQUEST_BYTES) {
		return json({ message: 'The request is too large.' }, { status: 413, headers });
	}
	let body: unknown;
	try {
		body = JSON.parse(raw);
	} catch {
		return json({ message: 'The request is not valid JSON.' }, { status: 400, headers });
	}
	const fields = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
	// About a second mate's task (`<task>@<mate>`): to that second mate's own inbox, not Firstmate's.
	if (typeof fields.taskId === 'string' && parseMateTaskId(fields.taskId)) {
		return toSecondMate(
			runtime,
			fields.taskId,
			request.headers.get('idempotency-key'),
			fields.text
		);
	}
	if (!runtime.messenger) {
		const reason = runtime.collector.health().messaging.reason ?? 'Messaging is not set up.';
		return json({ message: reason }, { status: 503, headers });
	}
	const valid = validateSend(request.headers.get('idempotency-key'), fields.text, fields.taskId);
	if (!valid.ok) return json({ message: valid.error }, { status: valid.status, headers });

	const r = await runtime.messenger.send(valid.input);
	if (!r.ok) return json({ message: r.error }, { status: r.status, headers });
	const status =
		r.message.delivery === 'uncertain' || r.message.delivery === 'sending'
			? 202
			: r.created
				? 201
				: 200;
	return json({ replay: !r.created, message: r.message }, { status, headers });
};

/**
 * A message about a second mate's task goes to that second mate, as a note in
 * its own inbox about the task (lib/server/firstmate/matetasks.ts): 201 when
 * it took it, 200 for a repeat of the same request id. Nothing is sent again
 * by itself when its host cannot be reached.
 */
async function toSecondMate(
	runtime: Extract<Awaited<ReturnType<typeof getRuntime>>, { configured: true }>,
	taskId: string,
	requestId: string | null,
	text: unknown
) {
	if (!requestId || !REQUEST_ID.test(requestId)) {
		return json(
			{ message: 'A valid Idempotency-Key header is required.' },
			{ status: 400, headers }
		);
	}
	if (typeof text !== 'string' || !text.trim()) {
		return json({ message: 'The message is empty.' }, { status: 400, headers });
	}
	const r = await runtime.mateTasks.send(taskId, requestId, text);
	if (!r.ok) return json({ message: r.error }, { status: r.status, headers });
	return json(
		{ replay: !r.created, secondMate: true, announced: r.announced },
		{ status: r.created ? 201 : 200, headers }
	);
}
