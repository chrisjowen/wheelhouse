import { json } from '@sveltejs/kit';
import { getRuntime } from '$lib/server/runtime';
import { NO_STORE } from '$lib/server/http';
import type { RequestHandler } from './$types';

/** How long a page waits for the archive to take in what it is still reading. */
const SETTLE_MS = 15_000;

/**
 * Earlier chat records from the chat archive (lib/server/chatarchive): those
 * before `before` (a record's or a session divider's id; the newest when
 * absent), about `limit` of them, and with `until`, back to that record at
 * least. Answers `{ records, more }`, oldest first, with each session's
 * divider before its first record; `available: false` without an archive.
 */
export const GET: RequestHandler = async ({ url }) => {
	const runtime = await getRuntime();
	const archive = runtime.configured ? runtime.archive : null;
	if (!archive) return json({ available: false, records: [], more: false }, { headers: NO_STORE });
	const before = url.searchParams.get('before');
	const until = url.searchParams.get('until');
	const limit = Number(url.searchParams.get('limit')) || undefined;
	// A record the chat has but the archive is still reading (its first pass over a long transcript).
	if ((before && !archive.has(before)) || (until && !archive.has(until)))
		await Promise.race([archive.settled(), new Promise((r) => setTimeout(r, SETTLE_MS))]);
	const page = await archive.page({ before, until, limit });
	return json({ available: true, ...page }, { headers: NO_STORE });
};
