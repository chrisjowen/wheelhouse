import { json } from '@sveltejs/kit';
import { NO_STORE, readJson } from '$lib/server/http';
import { MAX_FILE_BYTES } from '$lib/server/passages/schema';
import { editorService } from '$lib/server/passages/view';
import type { RequestHandler } from './$types';

/** Validate an edited passage file (`{ target, text }`) as it would apply; nothing is saved. */
export const POST: RequestHandler = async ({ params, request }) => {
	const read = await readJson(request, MAX_FILE_BYTES * 2 + 4096);
	if (!read.ok) return read.response;
	const { target, text } = read.body;
	if ((target !== 'project' && target !== 'captain') || typeof text !== 'string') {
		return json({ message: 'Send { target, text }.' }, { status: 400, headers: NO_STORE });
	}
	const k = await editorService(params.id);
	if (!k.ok) return json({ message: k.message }, { status: k.status, headers: NO_STORE });
	await k.passages.load(params.id);
	return json(k.passages.draft(params.id, target, text), { headers: NO_STORE });
};
