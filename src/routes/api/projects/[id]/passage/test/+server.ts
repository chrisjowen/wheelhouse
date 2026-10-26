import { json } from '@sveltejs/kit';
import { NO_STORE, readJson } from '$lib/server/http';
import { MAX_FILE_BYTES } from '$lib/server/passages/schema';
import { editorService } from '$lib/server/passages/view';
import type { PassageCommand } from '$lib/types';
import type { RequestHandler } from './$types';

/**
 * Test an edited passage file against one task: `{ target, text, taskId,
 * commands }`. Each check runs once now; command checks only when commands is
 * the list the captain ticked the box under, and the file still runs exactly
 * those. Nothing is saved or recorded.
 */
export const POST: RequestHandler = async ({ params, request }) => {
	const read = await readJson(request, MAX_FILE_BYTES * 2 + 4096);
	if (!read.ok) return read.response;
	const { target, text, taskId, commands } = read.body;
	if (
		(target !== 'project' && target !== 'captain') ||
		typeof text !== 'string' ||
		typeof taskId !== 'string' ||
		taskId.length > 200 ||
		(commands != null &&
			(!Array.isArray(commands) ||
				commands.length > 200 ||
				!commands.every((c) => typeof c === 'object' && c !== null)))
	) {
		return json(
			{ message: 'Send { target, text, taskId, commands }.' },
			{ status: 400, headers: NO_STORE }
		);
	}
	const k = await editorService(params.id);
	if (!k.ok) return json({ message: k.message }, { status: k.status, headers: NO_STORE });
	await k.passages.load(params.id);
	const r = await k.passages.dryRun(params.id, target, text, taskId, {
		commands: (commands ?? null) as PassageCommand[] | null
	});
	return json(r, { status: r.ok ? 200 : 422, headers: NO_STORE });
};
