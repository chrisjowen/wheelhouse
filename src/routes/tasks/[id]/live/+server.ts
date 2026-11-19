import { redirect } from '@sveltejs/kit';
import { recordedPreview } from '$lib/server/livereview/proxy';
import { reviewContext } from '$lib/server/livereview/scribe';
import { framingOrigin, remoteView } from '$lib/server/cloud/remote';
import type { RequestHandler } from './$types';

/** A path on this Wheelhouse to go back to (never another site's address). */
const backPath = (raw: string | null, id: string) =>
	raw && raw.startsWith('/') && !raw.startsWith('//') && !raw.includes('\\')
		? raw
		: `/tasks/${encodeURIComponent(id)}`;

const escape = (s: string) =>
	s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Why the review could not open, with the way back. */
const refused = (message: string, back: string, status: number) =>
	new Response(
		`<!doctype html><meta charset="utf-8"><title>Live review</title><body style="font:15px system-ui;max-width:36rem;margin:15vh auto;padding:0 16px;color:#333"><p>${escape(message)}</p><p><a href="${escape(back)}">Back to Wheelhouse</a></p>`,
		{ status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } }
	);

/**
 * A task's preview, opened for a live review (the experimental `livereview`
 * feature): the page itself, full screen in this tab, served through the
 * recording proxy, whose recorder adds the review's floating button and panel
 * to it (lib/server/livereview/proxy.ts). `back` is the Wheelhouse page it was
 * opened from, where the panel's way back goes. A task with no preview to
 * review opens its own page instead, with the reason.
 */
export const GET: RequestHandler = async ({ params, request, url }) => {
	const back = backPath(url.searchParams.get('back'), params.id);
	const found = await reviewContext(params.id);
	if (!found.ok) return refused(found.error, back, found.status);
	const { ctx } = found;
	// Through Wheelhouse Cloud the recorder could not reach Wheelhouse (the gateway refuses a
	// write from another host), so the preview opens as it is, at its address on the relay
	// (hooks.server.ts rewrites the redirect).
	if (remoteView(request)) redirect(303, ctx.url);
	const r = await recordedPreview(ctx.url, framingOrigin(request), {
		task: ctx.task.id,
		title: ctx.task.title,
		preview: ctx.url,
		back
	});
	if (!r.ok) return refused(r.error, back, 409);
	redirect(303, r.url);
};
