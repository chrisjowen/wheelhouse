import { json } from '@sveltejs/kit';
import { getRuntime } from '$lib/server/runtime';
import { NO_STORE } from '$lib/server/http';
import { previewProber } from '$lib/server/preview';
import { servedOrigin } from '$lib/server/session';
import { loopbackPreview } from '$lib/preview';
import type { RequestHandler } from './$types';

const NOT_ANSWERING = 'Nothing answers there right now; it shows here again as soon as it does.';

/**
 * Whether a preview no task reported (one Firstmate linked in a reply, or a
 * review board) can be shown embedded right now, as a task's preview is
 * checked (lib/server/preview.ts). Only an address on this computer that
 * Wheelhouse has itself shown (in a task's status, a decision card or
 * Firstmate's replies) is ever fetched, so a page cannot use this to probe
 * other ports.
 */
export const GET: RequestHandler = async ({ url, request }) => {
	const raw = url.searchParams.get('url') ?? '';
	const target = loopbackPreview(raw);
	if (!target.ok) return json({ message: target.reason }, { status: 400, headers: NO_STORE });
	const runtime = await getRuntime();
	if (!runtime.configured)
		return json({ message: runtime.error }, { status: 503, headers: NO_STORE });
	const origin = new URL(target.url).origin;
	const shown = (await runtime.seen.list()).some((a) => URL.parse(a)?.origin === origin);
	if (!shown) {
		return json(
			{ message: 'Wheelhouse has not shown this address, so it does not check it.' },
			{ status: 404, headers: NO_STORE }
		);
	}
	const check = await previewProber().check(
		{ url: target.url, reportedAt: new Date().toISOString() },
		servedOrigin(request)
	);
	// No worker is named for it: it is simply not answering.
	const reason = check.state === 'down' ? NOT_ANSWERING : check.reason;
	return json({ ...check, reportedAt: null, reason }, { headers: NO_STORE });
};
