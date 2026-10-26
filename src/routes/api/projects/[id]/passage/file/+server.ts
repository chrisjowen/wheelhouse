import { json } from '@sveltejs/kit';
import { NO_STORE, readJson } from '$lib/server/http';
import { MAX_FILE_BYTES } from '$lib/server/passages/schema';
import { editorService, passageEditor } from '$lib/server/passages/view';
import type { RequestHandler } from './$types';

const target = (v: unknown) => (v === 'project' || v === 'captain' ? v : null);

/** A passage file opened for editing (`?target=project|captain`), with the tasks a test can use. */
export const GET: RequestHandler = async ({ params, url }) => {
	const t = target(url.searchParams.get('target') ?? 'project');
	if (!t)
		return json(
			{ message: 'target must be project or captain.' },
			{ status: 400, headers: NO_STORE }
		);
	const r = await passageEditor(params.id, t);
	return r.ok
		? json({ ...r.editor, tasks: r.tasks }, { headers: NO_STORE })
		: json({ message: r.message }, { status: r.status, headers: NO_STORE });
};

/**
 * Save an edited passage file: `{ target, text, baseDigest }`, where
 * baseDigest is the sha256 the editor loaded (null for a new file). A file
 * that changed since is refused with 409, and one with problems with 422.
 * Origin and session token are checked in hooks.server.ts.
 */
export const PUT: RequestHandler = async ({ params, request }) => {
	const read = await readJson(request, MAX_FILE_BYTES * 2 + 4096);
	if (!read.ok) return read.response;
	const { text, baseDigest } = read.body;
	const t = target(read.body.target);
	if (!t || typeof text !== 'string') {
		return json(
			{ message: 'Send { target, text, baseDigest }.' },
			{ status: 400, headers: NO_STORE }
		);
	}
	if (
		baseDigest !== null &&
		(typeof baseDigest !== 'string' || !/^[0-9a-f]{64}$/.test(baseDigest))
	) {
		return json(
			{ message: 'baseDigest must be a sha256, or null.' },
			{ status: 400, headers: NO_STORE }
		);
	}
	const k = await editorService(params.id);
	if (!k.ok) return json({ message: k.message }, { status: k.status, headers: NO_STORE });
	const w = await k.passages.saveFile(params.id, t, text, baseDigest);
	if (!w.ok) return json(w, { status: w.status, headers: NO_STORE });
	const r = await passageEditor(params.id, t);
	return r.ok
		? json({ ...r.editor, tasks: r.tasks }, { headers: NO_STORE })
		: json({ message: r.message }, { status: r.status, headers: NO_STORE });
};
