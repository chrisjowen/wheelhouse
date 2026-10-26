import { json } from '@sveltejs/kit';
import { NO_STORE, readJson } from '$lib/server/http';
import { notFound, specStoreOrResponse } from '$lib/server/specs/access';
import type { RequestHandler } from './$types';

/**
 * Leave a comment on a section of the spec: `{ section, quote, text }`. The
 * interviewer addresses open comments on its next turn. Origin and session
 * token are checked in hooks.server.ts.
 */
export const POST: RequestHandler = async ({ params, request }) => {
	const store = await specStoreOrResponse();
	if (store instanceof Response) return store;
	const read = await readJson(request, 16 * 1024);
	if (!read.ok) return read.response;
	if (!(await store.get(params.id))) return notFound();
	const draft = await store.addComment(params.id, {
		section: read.body.section,
		quote: read.body.quote,
		text: read.body.text
	});
	if (!draft) {
		return json(
			{ message: 'Write a comment on one of the spec’s sections.' },
			{ status: 400, headers: NO_STORE }
		);
	}
	return json({ draft }, { status: 201, headers: NO_STORE });
};
