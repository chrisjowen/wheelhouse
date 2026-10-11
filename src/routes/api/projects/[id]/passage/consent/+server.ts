import { json } from '@sveltejs/kit';
import { setPassageConsent } from '$lib/server/passages/view';
import type { RequestHandler } from './$types';

const headers = { 'cache-control': 'no-store' };
const MAX_REQUEST_BYTES = 4 * 1024;

/**
 * Enable the network checks of a project's `.wheelhouse.yaml` (`{ digest }`,
 * the sha256 the passage page showed), or turn them off (`{ digest: null }`).
 * A digest that no longer matches the file is refused with 409, so the
 * captain always enables the version they reviewed.
 * Origin and session token are checked in hooks.server.ts.
 */
export const POST: RequestHandler = async ({ params, request }) => {
	if (!(request.headers.get('content-type') ?? '').includes('application/json')) {
		return json({ message: 'Send the request as JSON.' }, { status: 415, headers });
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
	const digest = (body as { digest?: unknown } | null)?.digest;
	if (digest !== null && (typeof digest !== 'string' || !/^[0-9a-f]{64}$/.test(digest))) {
		return json(
			{ message: 'digest must be the file’s sha256, or null.' },
			{ status: 400, headers }
		);
	}
	const r = await setPassageConsent(params.id, digest);
	return r.ok
		? json(r.view, { headers })
		: json({ message: r.message }, { status: r.status, headers });
};
