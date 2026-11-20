import { json } from '@sveltejs/kit';
import { NO_STORE, readJson } from '$lib/server/http';
import { getRuntime } from '$lib/server/runtime';
import type { RequestHandler } from './$types';

/**
 * Promote a task record into the library: its report and the files it links
 * are copied into `<shelf>/<folder>/<slug>` and committed. The record itself
 * is never changed. Body: `{ record, title, shelf, folder, slug, tags }`.
 */
export const POST: RequestHandler = async ({ request }) => {
	const runtime = await getRuntime();
	if (!runtime.configured)
		return json({ message: runtime.error }, { status: 503, headers: NO_STORE });
	const read = await readJson(request, 16 * 1024);
	if (!read.ok) return read.response;
	const r = await runtime.documents.promote(read.body);
	if (!r.ok) return json({ message: r.error }, { status: r.status, headers: NO_STORE });
	return json(r, { status: 201, headers: NO_STORE });
};
