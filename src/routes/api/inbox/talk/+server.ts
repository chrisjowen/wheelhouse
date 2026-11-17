import { json } from '@sveltejs/kit';
import { getRuntime } from '$lib/server/runtime';
import { talkTurn } from '$lib/server/inbox/talk';
import { talkRequest } from '$lib/decisiontalk';
import type { RequestHandler } from './$types';

const headers = { 'cache-control': 'no-store' };
const MAX_REQUEST_BYTES = 128 * 1024;

/**
 * One turn of talking a decision through with the discussion crew
 * (`{ cardId, options, messages }`, see lib/decisiontalk.ts). Nothing is sent
 * to Firstmate; the captain submits the outcome through POST /api/inbox.
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
	const req = talkRequest(body);
	if (!req) return json({ message: 'Name the decision.' }, { status: 400, headers });
	const r = await talkTurn(req);
	if (!r.ok) return json({ message: r.error }, { status: r.status, headers });
	return json(r.value, { headers });
};
