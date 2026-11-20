import { json } from '@sveltejs/kit';
import { NO_STORE } from '$lib/server/http';
import { defaultConfigDir } from '$lib/server/plugins/config';
import { getRuntime, currentFleet, currentInbox } from '$lib/server/runtime';
import { inFlight, LiveUnavailable, startSession } from '$lib/server/live/sessions';
import { readCrewSettings } from '$lib/server/live/tools';
import { titlesFor } from '$lib/server/documents/service';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { sectionFor } from '$lib/docsection';
import type { RequestHandler } from './$types';

/**
 * Start a Live mode discussion: brief a discussion crew member on the fleet,
 * the decisions waiting and the recent chat, and keep it running for the
 * captain to talk to (POST /api/live/<id>/say, events at /api/live/<id>/events).
 * `handoffs` says whether what the crew passes on is held for the captain
 * (Settings → Discussion). `{ decision: <card id> }` opens it on one decision:
 * the crew reads it in full first, with the part of its report it points at.
 * Behind the `discussion` experimental feature.
 */
export const POST: RequestHandler = async ({ request }) => {
	const runtime = await getRuntime();
	if (!runtime.configured)
		return json({ message: runtime.error }, { status: 503, headers: NO_STORE });
	await runtime.chat.refresh().catch(() => {});
	const body = (await request.json().catch(() => null)) as { decision?: unknown } | null;
	const decision =
		typeof body?.decision === 'string' && body.decision.length <= 300 ? body.decision : null;
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
				})),
			decision,
			reportOf: async (card) => {
				const file = await runtime.inbox.reportFile(card.id);
				const text = file ? await readFile(file, 'utf8') : null;
				return text ? sectionFor(text, [card.question, card.title, card.evidence.text]).text : null;
			}
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
