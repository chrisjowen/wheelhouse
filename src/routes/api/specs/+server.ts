import { json } from '@sveltejs/kit';
import { NO_STORE } from '$lib/server/http';
import { specStoreOrResponse } from '$lib/server/specs/access';
import type { RequestHandler } from './$types';

/** The captain's spec drafts, most recently edited first. */
export const GET: RequestHandler = async () => {
	const store = await specStoreOrResponse();
	if (store instanceof Response) return store;
	return json({ specs: await store.list() }, { headers: NO_STORE });
};

/** Start a new, empty draft. Origin and session token are checked in hooks.server.ts. */
export const POST: RequestHandler = async () => {
	const store = await specStoreOrResponse();
	if (store instanceof Response) return store;
	const draft = await store.create();
	return json({ draft, imageDir: store.imageDir(draft.id) }, { status: 201, headers: NO_STORE });
};
