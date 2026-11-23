import { json } from '@sveltejs/kit';
import { getRuntime } from '$lib/server/runtime';
import { NO_STORE, readJson } from '$lib/server/http';
import type { RequestHandler } from './$types';

/** When the captain last cleared the chat's view, or null. */
export const GET: RequestHandler = async () => {
	const runtime = await getRuntime();
	const clearedAt = runtime.configured ? (runtime.cleared?.clearedAt() ?? null) : null;
	return json({ clearedAt }, { headers: NO_STORE });
};

/**
 * Clears the chat's view as of now (`{ cleared: true }`), or shows everything
 * again (`{ cleared: false }`), on every device. Only what the chat shows
 * changes: the history and Firstmate's conversation are left as they are, and
 * nothing is sent to Firstmate. Guarded in hooks.server.ts.
 */
export const POST: RequestHandler = async ({ request }) => {
	const runtime = await getRuntime();
	if (!runtime.configured)
		return json({ message: runtime.error }, { status: 503, headers: NO_STORE });
	if (!runtime.cleared)
		return json(
			{
				message:
					'The Wheelhouse state directory is inside the Firstmate home, so a cleared view cannot be kept.'
			},
			{ status: 503, headers: NO_STORE }
		);
	const read = await readJson(request, 1024);
	if (!read.ok) return read.response;
	const { cleared } = read.body;
	if (typeof cleared !== 'boolean')
		return json(
			{ message: 'Say whether the chat is cleared.' },
			{ status: 400, headers: NO_STORE }
		);
	await runtime.cleared.set(cleared ? new Date() : null).catch(() => {});
	return json({ clearedAt: runtime.cleared.clearedAt() }, { headers: NO_STORE });
};
