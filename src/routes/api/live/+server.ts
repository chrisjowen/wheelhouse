import { json } from '@sveltejs/kit';
import { NO_STORE } from '$lib/server/http';
import { defaultConfigDir } from '$lib/server/plugins/config';
import { getRuntime, currentFleet, currentInbox } from '$lib/server/runtime';
import { inFlight, LiveUnavailable, startSession } from '$lib/server/live/sessions';
import { readCrewSettings } from '$lib/server/live/tools';
import { titlesFor } from '$lib/server/documents/service';
import path from 'node:path';
import type { RequestHandler } from './$types';

/**
 * Start a Live mode discussion: brief a discussion crew member on the fleet,
 * the decisions waiting and the recent chat, and keep it running for the
 * captain to talk to (POST /api/live/<id>/say, events at /api/live/<id>/events).
 * `handoffs` says whether what the crew passes on is held for the captain
 * (Settings → Discussion). Behind the `discussion` experimental feature.
 */
export const POST: RequestHandler = async () => {
	const runtime = await getRuntime();
	if (!runtime.configured)
		return json({ message: runtime.error }, { status: 503, headers: NO_STORE });
	await runtime.chat.refresh().catch(() => {});
	try {
		const configDir = defaultConfigDir(process.env);
		const s = await startSession({
			fleet: currentFleet,
			inbox: currentInbox,
			records: () => runtime.chat.snapshot(),
			home: runtime.install.homeDir,
			configDir,
			documents: async (projects) =>
				titlesFor(await runtime.documents.index(), projects).map((r) => ({
					title: r.title,
					project: r.project,
					file: path.isAbsolute(r.path) ? r.path : path.join(runtime.install.homeDir, r.path)
				}))
		});
		const { handoffs } = await readCrewSettings(configDir);
		return json(
			{
				id: s.id,
				model: s.model,
				context: s.context,
				handoffs,
				knows: {
					live: inFlight(s.before.fleet),
					tasks: s.before.fleet.tasks.length,
					decisions: s.before.inbox.cards.length
				}
			},
			{ headers: NO_STORE }
		);
	} catch (error) {
		const message =
			error instanceof LiveUnavailable ? error.message : 'The discussion crew could not start.';
		return json({ message }, { status: 503, headers: NO_STORE });
	}
};
