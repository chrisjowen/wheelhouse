import { json } from '@sveltejs/kit';
import { NO_STORE } from '$lib/server/http';
import { notFound, specStoreOrResponse } from '$lib/server/specs/access';
import { SPEC_IMAGE_MAX_BYTES, SPEC_IMAGE_TYPES } from '$lib/server/specs/store';
import type { RequestHandler } from './$types';

/**
 * Attach a picture to a draft: the request body is the image itself, its
 * Content-Type one of PNG, JPEG, WebP or GIF; an optional `x-caption` header
 * (URI-encoded) names it. Origin and session token are checked in hooks.server.ts.
 */
export const POST: RequestHandler = async ({ params, request }) => {
	const store = await specStoreOrResponse();
	if (store instanceof Response) return store;
	const type = (request.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
	if (!SPEC_IMAGE_TYPES[type]) {
		return json(
			{ message: 'Attach a PNG, JPEG, WebP or GIF picture.' },
			{ status: 415, headers: NO_STORE }
		);
	}
	const bytes = new Uint8Array(await request.arrayBuffer());
	if (bytes.byteLength > SPEC_IMAGE_MAX_BYTES) {
		return json(
			{ message: `A picture is limited to ${SPEC_IMAGE_MAX_BYTES / 1024 / 1024} MB.` },
			{ status: 413, headers: NO_STORE }
		);
	}
	let caption = '';
	try {
		caption = decodeURIComponent(request.headers.get('x-caption') ?? '');
	} catch {
		// keep it uncaptioned
	}
	const draft = await store.addImage(params.id, type, bytes, caption);
	if (!draft) return notFound();
	return json({ draft }, { status: 201, headers: NO_STORE });
};
