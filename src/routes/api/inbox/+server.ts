import { json } from '@sveltejs/kit';
import { currentInbox, getRuntime } from '$lib/server/runtime';
import type { RequestHandler } from './$types';

const headers = { 'cache-control': 'no-store' };
const MAX_REQUEST_BYTES = 16 * 1024;

/** Every open question: review findings, worker decisions, captain holds and merge calls. */
export const GET: RequestHandler = async () => json(await currentInbox(), { headers });

/**
 * Answer one card: `{ cardId, choice: approve|fix|skip, note? }` with an
 * Idempotency-Key header. The answer goes to Firstmate as a message through
 * `fm-inbox.sh note` (never to a worker directly); repeating the key returns
 * the original message. Origin and session token are checked in hooks.server.ts.
 */
export const POST: RequestHandler = async ({ request }) => {
	const runtime = await getRuntime();
	if (!runtime.configured) return json({ message: runtime.error }, { status: 503, headers });
	if (!(request.headers.get('content-type') ?? '').includes('application/json')) {
		return json({ message: 'Send the answer as JSON.' }, { status: 415, headers });
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
	const r = await runtime.inbox.answer(request.headers.get('idempotency-key'), fields);
	if (!r.ok) return json({ message: r.error }, { status: r.status, headers });
	const status =
		r.message.delivery === 'uncertain' || r.message.delivery === 'sending'
			? 202
			: r.created
				? 201
				: 200;
	return json({ replay: !r.created, message: r.message }, { status, headers });
};
