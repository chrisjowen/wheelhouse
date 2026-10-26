import { json } from '@sveltejs/kit';
import { NO_STORE, readJson } from '$lib/server/http';
import { setCommandConsent } from '$lib/server/passages/view';
import type { RequestHandler } from './$types';

/**
 * Allow a project's command checks (`{ digest }`, the digest of exactly what
 * they run, as the passage page showed it), or turn them off
 * (`{ digest: null }`). A digest that no longer matches the commands is
 * refused with 409, so the captain always allows the commands they read.
 * Origin and session token are checked in hooks.server.ts.
 */
export const POST: RequestHandler = async ({ params, request }) => {
	const read = await readJson(request, 4 * 1024);
	if (!read.ok) return read.response;
	const digest = read.body.digest;
	if (digest !== null && (typeof digest !== 'string' || !/^[0-9a-f]{64}$/.test(digest))) {
		return json(
			{ message: 'digest must be the commands’ sha256, or null.' },
			{ status: 400, headers: NO_STORE }
		);
	}
	const r = await setCommandConsent(params.id, digest);
	return r.ok
		? json(r.view, { headers: NO_STORE })
		: json({ message: r.message }, { status: r.status, headers: NO_STORE });
};
