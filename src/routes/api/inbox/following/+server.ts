import { json } from '@sveltejs/kit';
import { getRuntime } from '$lib/server/runtime';
import type { RequestHandler } from './$types';

const headers = { 'cache-control': 'no-store' };
const MAX_REQUEST_BYTES = 4 * 1024;

/**
 * Follow up a task's decision with Firstmate in the main chat, or put it back
 * to waiting: `{ taskId, following: true|false }`. Kept in Wheelhouse's own
 * state directory, so every browser shows it; a decision being followed up no
 * longer counts as waiting on the captain. Nothing is sent to Firstmate.
 * Origin and session token are checked in hooks.server.ts.
 */
export const POST: RequestHandler = async ({ request }) => {
	const runtime = await getRuntime();
	if (!runtime.configured) return json({ message: runtime.error }, { status: 503, headers });
	if (!(request.headers.get('content-type') ?? '').includes('application/json')) {
		return json({ message: 'Send it as JSON.' }, { status: 415, headers });
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
	const r = await runtime.inbox.follow(fields);
	if (!r.ok) return json({ message: r.error }, { status: r.status, headers });
	return json({ following: r.following }, { headers });
};
