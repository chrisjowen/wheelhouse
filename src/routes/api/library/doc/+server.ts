import { json } from '@sveltejs/kit';
import { NO_STORE } from '$lib/server/http';
import { getRuntime } from '$lib/server/runtime';
import type { RequestHandler } from './$types';

/** One library document's metadata and history (`?key=<shelf>/<folder>/<slug>`), to follow an edit. */
export const GET: RequestHandler = async ({ url }) => {
	const runtime = await getRuntime();
	if (!runtime.configured)
		return json({ message: runtime.error }, { status: 503, headers: NO_STORE });
	const d = await runtime.documents.libraryDoc(url.searchParams.get('key') ?? '');
	if (!d)
		return json({ message: 'There is no such document.' }, { status: 404, headers: NO_STORE });
	return json({ doc: d.doc, history: d.history, markdown: d.markdown }, { headers: NO_STORE });
};
