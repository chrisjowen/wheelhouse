import { json } from '@sveltejs/kit';
import { NO_STORE } from '$lib/server/http';
import { notFound, specStoreOrResponse } from '$lib/server/specs/access';
import { MAX_MESSAGE_BYTES, specMarkdown, specMessage } from '$lib/spec';
import type { RequestHandler } from './$types';

/**
 * The build request "Send to build" posts to Firstmate, made from the saved
 * draft: the whole spec in one message, or, when that is too long for one
 * message, a short message pointing at the spec written beside the draft as
 * a file. Origin and session token are checked in hooks.server.ts.
 */
export const POST: RequestHandler = async ({ params }) => {
	const store = await specStoreOrResponse();
	if (store instanceof Response) return store;
	const draft = await store.get(params.id);
	if (!draft) return notFound();
	const dir = store.imageDir(draft.id);
	const image = (img: { name: string }) => `${dir}/${img.name}`;
	const whole = specMessage(draft, image);
	if (Buffer.byteLength(whole) <= MAX_MESSAGE_BYTES) {
		return json({ message: whole, attachment: null }, { headers: NO_STORE });
	}
	const attachment = await store.writeAttachment(draft.id, specMarkdown(draft, image));
	if (!attachment) return notFound();
	return json(
		{ message: specMessage(draft, image, attachment), attachment },
		{ headers: NO_STORE }
	);
};
