import { json } from '@sveltejs/kit';
import { getRuntime } from '$lib/server/runtime';
import { NO_STORE, readJson } from '$lib/server/http';
import { isReactionId } from '$lib/server/firstmate/reactions';
import type { RequestHandler } from './$types';

/** The chat messages the captain gave a 👍, oldest first. */
export const GET: RequestHandler = async () => {
	const runtime = await getRuntime();
	const liked = runtime.configured ? (runtime.reactions?.list() ?? []) : [];
	return json({ liked }, { headers: NO_STORE });
};

/**
 * Mark (`on: true`) or unmark a chat message's 👍, by its id: `{ id, on }`.
 * A mark that could not be written to disk is kept until Wheelhouse restarts.
 * Guarded in hooks.server.ts.
 */
export const POST: RequestHandler = async ({ request }) => {
	const runtime = await getRuntime();
	if (!runtime.configured)
		return json({ message: runtime.error }, { status: 503, headers: NO_STORE });
	if (!runtime.reactions)
		return json(
			{
				message:
					'The Wheelhouse state directory is inside the Firstmate home, so marks cannot be kept.'
			},
			{ status: 503, headers: NO_STORE }
		);
	const read = await readJson(request, 4096);
	if (!read.ok) return read.response;
	const { id, on } = read.body;
	if (!isReactionId(id) || typeof on !== 'boolean')
		return json(
			{ message: 'Name the message and whether it is marked.' },
			{ status: 400, headers: NO_STORE }
		);
	await runtime.reactions.set(id, on).catch(() => {});
	return json({ liked: runtime.reactions.list() }, { headers: NO_STORE });
};
