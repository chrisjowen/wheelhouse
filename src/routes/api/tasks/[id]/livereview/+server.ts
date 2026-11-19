import { json } from '@sveltejs/kit';
import { readReviewRequest } from '$lib/livereview';
import { NO_STORE, readJson } from '$lib/server/http';
import { recordedPreview } from '$lib/server/livereview/proxy';
import {
	answer,
	reviewContext,
	saveSession,
	takeNotes,
	tidyPack
} from '$lib/server/livereview/scribe';
import { framingOrigin } from '$lib/server/cloud/remote';
import type { RequestHandler } from './$types';

/** The pack's screenshots ride along when it is saved, so this is near the body limit. */
const MAX_REQUEST_BYTES = 24 * 1024 * 1024;

/**
 * A live review session on the task's preview (the experimental `livereview`
 * feature, see lib/livereview.ts), one action per call:
 * - `proxy`: the address of the recorded copy of the preview, to frame (and
 *   the preview's own address, which the pack names);
 * - `notes`: a round of the scribe's notes over the timeline so far;
 * - `reply`: the scribe's answer to what the captain just said;
 * - `pack`: the notes tidied into the feedback pack;
 * - `save`: keep the session and its screenshots as files, before the pack
 *   goes to Firstmate (which the page sends, as any message).
 * Nothing here sends anything to Firstmate. Origin and session token are
 * checked in hooks.server.ts, and the feature's switch there too.
 */
export const POST: RequestHandler = async ({ params, request }) => {
	const read = await readJson(request, MAX_REQUEST_BYTES);
	if (!read.ok) return read.response;
	const req = readReviewRequest(read.body);
	if (!req.ok) return json({ message: req.error }, { status: 400, headers: NO_STORE });
	const found = await reviewContext(params.id);
	if (!found.ok) return json({ message: found.error }, { status: found.status, headers: NO_STORE });
	const { ctx } = found;
	const fail = (r: { status: number; error: string }) =>
		json({ message: r.error }, { status: r.status, headers: NO_STORE });
	switch (req.action) {
		case 'proxy': {
			const r = await recordedPreview(ctx.url, framingOrigin(request));
			if (!r.ok) return json({ message: r.error }, { status: 409, headers: NO_STORE });
			return json({ url: r.url, preview: ctx.url }, { headers: NO_STORE });
		}
		case 'notes': {
			const r = await takeNotes(ctx, req);
			return r.ok ? json({ notes: r.notes, heard: r.heard }, { headers: NO_STORE }) : fail(r);
		}
		case 'reply': {
			const r = await answer(ctx, req.reply);
			return r.ok ? json({ reply: r.reply }, { headers: NO_STORE }) : fail(r);
		}
		case 'pack': {
			const r = await tidyPack(ctx, req);
			return r.ok ? json(r.pack, { headers: NO_STORE }) : fail(r);
		}
		case 'save': {
			try {
				const saved = await saveSession(ctx.task.id, req.session, req.shots);
				return json(saved, { headers: NO_STORE });
			} catch (error) {
				return json(
					{ message: `Wheelhouse could not keep the session: ${(error as Error).message}` },
					{ status: 500, headers: NO_STORE }
				);
			}
		}
	}
};
