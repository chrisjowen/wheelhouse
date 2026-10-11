import { error, json } from '@sveltejs/kit';
import { getRuntime } from '$lib/server/runtime';
import { PREVIEW_DEFAULT_LINES } from '$lib/server/sessions/sessions';
import type { RequestHandler } from './$types';

/**
 * A bounded, read-only sample of a session's last lines (tmux capture-pane).
 * Nothing from the browser ever reaches the session.
 */
export const GET: RequestHandler = async ({ params, url }) => {
	const runtime = await getRuntime();
	if (!runtime.configured) error(503, runtime.error);
	const asked = Number(url.searchParams.get('lines') ?? PREVIEW_DEFAULT_LINES);
	const lines = Number.isFinite(asked) ? asked : PREVIEW_DEFAULT_LINES;
	const out = await runtime.sessions.preview(params.id, lines);
	if (!out) error(404, `There is no session called ${params.id}.`);
	return json(out, { headers: { 'cache-control': 'no-store' } });
};
