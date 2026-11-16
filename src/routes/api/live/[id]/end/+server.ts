import { json } from '@sveltejs/kit';
import { NO_STORE } from '$lib/server/http';
import { currentFleet, currentInbox } from '$lib/server/runtime';
import { catchUp, endSession, inFlight, liveSession } from '$lib/server/live/sessions';
import type { RequestHandler } from './$types';

/**
 * End a discussion: the crew writes the Captain's briefing from what was said,
 * and the fleet is compared with how it stood at the start for the catch-up.
 * Nothing is sent to Firstmate here; the captain sends the briefing from the chat.
 */
export const POST: RequestHandler = async ({ params }) => {
	const session = liveSession(params.id);
	if (!session) return json({ message: 'No such discussion.' }, { status: 404, headers: NO_STORE });
	const briefing = await session.crew.brief();
	const [fleet, inbox] = await Promise.all([currentFleet(), currentInbox()]);
	endSession(session.id);
	return json(
		{
			briefing,
			catchUp: catchUp(session.before, { fleet, inbox }),
			minutes: Math.max(1, Math.round((Date.now() - session.startedAt) / 60_000)),
			fleet: { live: inFlight(fleet), decisions: inbox.cards.length }
		},
		{ headers: NO_STORE }
	);
};
