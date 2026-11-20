import { json } from '@sveltejs/kit';
import { NO_STORE } from '$lib/server/http';
import { currentFleet, currentInbox } from '$lib/server/runtime';
import { catchUp, endSession, inFlight, liveSession } from '$lib/server/live/sessions';
import { briefingNote } from '$lib/server/live/prompt';
import type { RequestHandler } from './$types';

/**
 * End a discussion: unless the captain just quits (`{ brief: false }`), the
 * crew writes the Captain's briefing from what was said; either way the fleet
 * is compared with how it stood at the start for the catch-up. `handoffs`
 * says which of the crew's notes for Firstmate are still waiting (attached to
 * the briefing by the chat), were sent or were deleted, and `scouts` the
 * questions already sent off, so the briefing neither repeats nor revives
 * them. Nothing is sent to Firstmate here; the captain sends the briefing
 * from the chat.
 */
export const POST: RequestHandler = async ({ params, request }) => {
	const session = liveSession(params.id);
	if (!session) return json({ message: 'No such discussion.' }, { status: 404, headers: NO_STORE });
	const body = (await request.json().catch(() => ({}))) as {
		brief?: unknown;
		handoffs?: Record<string, unknown>;
		scouts?: unknown;
	};
	const notes = (v: unknown) =>
		Array.isArray(v)
			? v
					.filter((x): x is string => typeof x === 'string' && !!x.trim())
					.slice(0, 40)
					.map((x) => x.slice(0, 1200))
			: [];
	const h = body.handoffs && typeof body.handoffs === 'object' ? body.handoffs : {};
	const note = briefingNote({
		pending: notes(h.pending),
		sent: notes(h.sent),
		deleted: notes(h.deleted),
		scouts: notes(body.scouts)
	});
	const briefing = body.brief === false ? null : await session.crew.brief(note);
	const [fleet, inbox] = await Promise.all([currentFleet(), currentInbox()]);
	endSession(session.id);
	return json(
		{
			briefing,
			quit: body.brief === false,
			catchUp: catchUp(session.before, { fleet, inbox }),
			minutes: Math.max(1, Math.round((Date.now() - session.startedAt) / 60_000)),
			fleet: { live: inFlight(fleet), decisions: inbox.cards.length }
		},
		{ headers: NO_STORE }
	);
};
