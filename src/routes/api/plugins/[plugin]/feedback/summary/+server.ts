import { json } from '@sveltejs/kit';
import { NO_STORE, readJson } from '$lib/server/http';
import { summarisePluginFeedback } from '$lib/server/plugins/feedback';
import { summariseFeedback } from '$lib/server/previewhelper';
import { getRuntime } from '$lib/server/runtime';
import { refuse } from '$lib/server/upgrade/requests';
import type { RequestHandler } from './$types';

/**
 * A plugin's feedback list tidied by the preview helper before the captain
 * sends it (the `feedback` capability, see lib/server/plugins/feedback.ts):
 * `{ taskId, subject?, items: [{ text, points? }] }` in, as for a send;
 * `{ points: [{ text, points, from }] }` out, `from` naming the items (from 1)
 * each point came from. It sends nothing. Origin and session token are
 * checked in hooks.server.ts.
 */
export const POST: RequestHandler = async ({ params, request }) => {
	const runtime = await getRuntime();
	if (!runtime.configured) return refuse(runtime.error, 503);
	const body = await readJson(request, 64 * 1024);
	if (!body.ok) return body.response;
	const r = await summarisePluginFeedback(
		{
			sender: (plugin, task) => runtime.plugins.feedbackSender(plugin, task),
			summarise: (req) => summariseFeedback(req)
		},
		params.plugin,
		body.body
	);
	if (!r.ok) return refuse(r.error, r.status);
	return json({ points: r.points }, { headers: NO_STORE });
};
