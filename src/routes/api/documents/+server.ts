import { json } from '@sveltejs/kit';
import { NO_STORE } from '$lib/server/http';
import { getRuntime } from '$lib/server/runtime';
import type { RequestHandler } from './$types';

/**
 * The fleet's documents: task records and prototypes read from the home, and
 * the library (see server/documents). Titles and metadata only; read only.
 */
export const GET: RequestHandler = async () => {
	const runtime = await getRuntime();
	if (!runtime.configured)
		return json({ message: runtime.error }, { status: 503, headers: NO_STORE });
	return json(await runtime.documents.index(), { headers: NO_STORE });
};
