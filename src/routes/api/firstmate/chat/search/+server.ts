import { json } from '@sveltejs/kit';
import { getRuntime } from '$lib/server/runtime';
import { NO_STORE } from '$lib/server/http';
import type { RequestHandler } from './$types';

/**
 * The captain's messages and Firstmate's replies in the chat archive that hold
 * every word of `q`, newest first (at most `limit`, 50 by default).
 */
export const GET: RequestHandler = async ({ url }) => {
	const runtime = await getRuntime();
	const archive = runtime.configured ? runtime.archive : null;
	if (!archive) return json({ available: false, hits: [] }, { headers: NO_STORE });
	const q = (url.searchParams.get('q') ?? '').slice(0, 200);
	const limit = Math.min(Number(url.searchParams.get('limit')) || 50, 200);
	return json({ available: true, hits: archive.search(q, limit) }, { headers: NO_STORE });
};
