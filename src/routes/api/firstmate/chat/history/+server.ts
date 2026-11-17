import { json } from '@sveltejs/kit';
import { getRuntime } from '$lib/server/runtime';
import { NO_STORE } from '$lib/server/http';
import type { RequestHandler } from './$types';

/** How long a page waits for the archive to take in what it is still reading. */
const SETTLE_MS = 15_000;

/**
 * Earlier chat records from the chat archive (lib/server/chatarchive): those
 * before the first `before` it holds (a record's or a session divider's id;
 * may repeat), else those older than the time `at` (none when neither is
 * known; the newest when neither is given), about `limit` of them, and with `until`, back to that record at
 * least. Answers `{ records, more }`, oldest first, with each session's
 * divider before its first record; `available: false` without an archive.
 */
export const GET: RequestHandler = async ({ url }) => {
	const runtime = await getRuntime();
	const archive = runtime.configured ? runtime.archive : null;
	if (!archive) return json({ available: false, records: [], more: false }, { headers: NO_STORE });
	const before = url.searchParams.getAll('before');
	const at = url.searchParams.get('at');
	const until = url.searchParams.get('until');
	const limit = Number(url.searchParams.get('limit')) || undefined;
	// A record the chat has but the archive is still reading (its first pass over a long transcript).
	const held = await Promise.all(before.map((id) => archive.has(id)));
	if ((before.length && !held.some(Boolean)) || (until && !(await archive.has(until))))
		await Promise.race([archive.settled(), new Promise((r) => setTimeout(r, SETTLE_MS))]);
	const page = await archive.page({ before, at, until, limit });
	return json({ available: true, ...page }, { headers: NO_STORE });
};
