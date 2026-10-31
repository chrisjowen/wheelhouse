import { json } from '@sveltejs/kit';
import { NAME_HEADER, TYPE_HEADER, UPLOAD_MAX_BYTES } from '$lib/chat/attachments';
import { NO_STORE } from '$lib/server/http';
import { cleanUploads, safeType, saveUpload, TOO_LARGE, uploadsDir } from '$lib/server/uploads';
import type { RequestHandler } from './$types';

/**
 * Save one file the captain attached in the chat: the body is the file's bytes,
 * TYPE_HEADER its type and NAME_HEADER its name. Answers the
 * attachment the message will name (see lib/chat/attachments.ts). Loopback
 * Host, Origin and session token are checked in hooks.server.ts, as for every
 * change.
 */
export const POST: RequestHandler = async ({ request }) => {
	const declared = Number(request.headers.get('content-length') ?? '');
	if (declared > UPLOAD_MAX_BYTES) {
		return json({ message: TOO_LARGE }, { status: 413, headers: NO_STORE });
	}
	let name: string;
	try {
		name = decodeURIComponent(request.headers.get(NAME_HEADER) ?? '');
	} catch {
		return json({ message: 'The file name is not valid.' }, { status: 400, headers: NO_STORE });
	}
	const dir = uploadsDir(process.env);
	void cleanUploads(dir);
	const saved = await saveUpload(dir, {
		name,
		type: safeType(request.headers.get(TYPE_HEADER)),
		body: request.body
	});
	if (!saved.ok) return json({ message: saved.error }, { status: saved.status, headers: NO_STORE });
	return json(saved.upload, { status: 201, headers: NO_STORE });
};
