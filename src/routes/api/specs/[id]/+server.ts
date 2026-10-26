import { json } from '@sveltejs/kit';
import { NO_STORE, readJson } from '$lib/server/http';
import { notFound, specInterviewer, specStoreOrResponse } from '$lib/server/specs/access';
import type { RequestHandler } from './$types';

/** A draft is at most this large as JSON. */
const MAX_BYTES = 1024 * 1024;

/**
 * One draft, the folder its pictures are kept in (named in the message to
 * Firstmate), and whether the interviewer is working on it.
 */
export const GET: RequestHandler = async ({ params }) => {
	const store = await specStoreOrResponse();
	if (store instanceof Response) return store;
	const draft = await store.get(params.id);
	if (!draft) return notFound();
	return json(
		{
			draft,
			imageDir: store.imageDir(draft.id),
			busy: specInterviewer(store).isBusy(draft.id)
		},
		{ headers: NO_STORE }
	);
};

/** Save the captain's edits. Origin and session token are checked in hooks.server.ts. */
export const PUT: RequestHandler = async ({ params, request }) => {
	const store = await specStoreOrResponse();
	if (store instanceof Response) return store;
	const read = await readJson(request, MAX_BYTES);
	if (!read.ok) return read.response;
	const draft = await store.save(params.id, read.body);
	if (!draft) return notFound();
	return json({ draft }, { headers: NO_STORE });
};

export const DELETE: RequestHandler = async ({ params }) => {
	const store = await specStoreOrResponse();
	if (store instanceof Response) return store;
	if (!(await store.remove(params.id))) return notFound();
	return json({ deleted: true }, { headers: NO_STORE });
};
