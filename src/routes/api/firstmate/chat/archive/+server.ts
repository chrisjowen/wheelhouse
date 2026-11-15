import { json } from '@sveltejs/kit';
import { getRuntime } from '$lib/server/runtime';
import { NO_STORE, readJson } from '$lib/server/http';
import { RETENTION_DAYS, type Retention } from '$lib/server/chatarchive/archive';
import type { RequestHandler } from './$types';

const UNAVAILABLE =
	'The Wheelhouse state directory is inside the Firstmate home, so the chat is not archived.';

/** The chat archive's size and retention (Settings → Chat history). */
export const GET: RequestHandler = async () => {
	const runtime = await getRuntime();
	if (!runtime.configured)
		return json({ message: runtime.error }, { status: 503, headers: NO_STORE });
	if (!runtime.archive) return json({ message: UNAVAILABLE }, { status: 503, headers: NO_STORE });
	return json(runtime.archive.stats(), { headers: NO_STORE });
};

/**
 * Sets how long the archive keeps sessions: `{ retentionDays }`, one of
 * RETENTION_DAYS (null keeps everything). Sessions that ended before it are
 * deleted at once. Guarded in hooks.server.ts.
 */
export const POST: RequestHandler = async ({ request }) => {
	const runtime = await getRuntime();
	if (!runtime.configured)
		return json({ message: runtime.error }, { status: 503, headers: NO_STORE });
	if (!runtime.archive) return json({ message: UNAVAILABLE }, { status: 503, headers: NO_STORE });
	const read = await readJson(request, 1024);
	if (!read.ok) return read.response;
	const days = read.body.retentionDays as Retention;
	if (!RETENTION_DAYS.some((d) => d === days))
		return json(
			{
				message: `Keep the chat for one of: ${RETENTION_DAYS.map((d) => d ?? 'always').join(', ')}.`
			},
			{ status: 400, headers: NO_STORE }
		);
	return json(await runtime.archive.setRetention(days), { headers: NO_STORE });
};
