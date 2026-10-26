import { json } from '@sveltejs/kit';
import { NO_STORE, readJson } from '$lib/server/http';
import { MAX_FILE_BYTES } from '$lib/server/passages/schema';
import { editorService } from '$lib/server/passages/view';
import type { RequestHandler } from './$types';

/**
 * Test an edited passage file against one task: `{ target, text, taskId,
 * runCommands }`. Each check runs once now; command checks only when
 * runCommands is true (the captain ticked the box listing them). Nothing is
 * saved or recorded.
 */
export const POST: RequestHandler = async ({ params, request }) => {
	const read = await readJson(request, MAX_FILE_BYTES * 2 + 4096);
	if (!read.ok) return read.response;
	const { target, text, taskId, runCommands } = read.body;
	if (
		(target !== 'project' && target !== 'captain') ||
		typeof text !== 'string' ||
		typeof taskId !== 'string' ||
		taskId.length > 200
	) {
		return json(
			{ message: 'Send { target, text, taskId, runCommands }.' },
			{ status: 400, headers: NO_STORE }
		);
	}
	const k = await editorService(params.id);
	if (!k.ok) return json({ message: k.message }, { status: k.status, headers: NO_STORE });
	await k.passages.load(params.id);
	const r = await k.passages.dryRun(params.id, target, text, taskId, {
		runCommands: runCommands === true
	});
	return json(r, { status: r.ok ? 200 : 422, headers: NO_STORE });
};
