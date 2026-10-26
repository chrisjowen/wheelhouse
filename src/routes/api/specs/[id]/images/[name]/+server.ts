import { json } from '@sveltejs/kit';
import { NO_STORE } from '$lib/server/http';
import { notFound, specStoreOrResponse } from '$lib/server/specs/access';
import type { RequestHandler } from './$types';

/** A picture the draft lists (nothing else is served). */
export const GET: RequestHandler = async ({ params }) => {
	const store = await specStoreOrResponse();
	if (store instanceof Response) return store;
	const img = await store.readImage(params.id, params.name);
	if (!img) return new Response('Not found', { status: 404 });
	return new Response(new Uint8Array(img.bytes), {
		headers: {
			'content-type': img.type,
			'cache-control': 'private, max-age=3600',
			'x-content-type-options': 'nosniff'
		}
	});
};

/** Remove a picture from a draft. Origin and session token are checked in hooks.server.ts. */
export const DELETE: RequestHandler = async ({ params }) => {
	const store = await specStoreOrResponse();
	if (store instanceof Response) return store;
	const draft = await store.removeImage(params.id, params.name);
	if (!draft) return notFound();
	return json({ draft }, { headers: NO_STORE });
};
