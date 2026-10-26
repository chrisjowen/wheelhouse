import { json } from '@sveltejs/kit';
import { NO_STORE } from '$lib/server/http';
import { notFound, specStoreOrResponse } from '$lib/server/specs/access';
import type { RequestHandler } from './$types';

/** Take a comment back. Origin and session token are checked in hooks.server.ts. */
export const DELETE: RequestHandler = async ({ params }) => {
	const store = await specStoreOrResponse();
	if (store instanceof Response) return store;
	const draft = await store.removeComment(params.id, params.comment);
	if (!draft) return notFound();
	return json({ draft }, { headers: NO_STORE });
};
