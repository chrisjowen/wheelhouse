import { json } from '@sveltejs/kit';
import { NO_STORE } from '$lib/server/http';
import { updateService } from '$lib/server/upgrade/service';
import type { RequestHandler } from './$types';

/**
 * Change the update source. POST { source: 'published' | 'github' }.
 * When switching, performs the matching reinstall/relink and restarts.
 * Answers 200 on success, 409 when it cannot start (busy or no restart).
 */
export const POST: RequestHandler = async ({ request }) => {
	const s = updateService();
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return json({ message: 'Invalid JSON.' }, { status: 400, headers: NO_STORE });
	}
	const src = (body as Record<string, unknown> | null)?.source;
	if (src !== 'published' && src !== 'github') {
		return json(
			{ message: 'source must be "published" or "github".' },
			{ status: 400, headers: NO_STORE }
		);
	}
	const r = await s.setSource(src);
	if (!r.ok) return json({ message: r.error }, { status: 409, headers: NO_STORE });
	return json(await s.wheelhouse(), { headers: NO_STORE });
};
