import { json } from '@sveltejs/kit';
import { NO_STORE } from '$lib/server/http';
import { liveSession } from '$lib/server/live/sessions';
import type { RequestHandler } from './$types';

/** The captain talked over the crew: stop its answer. */
export const POST: RequestHandler = async ({ params }) => {
	const session = liveSession(params.id);
	if (!session) return json({ message: 'No such discussion.' }, { status: 404, headers: NO_STORE });
	session.crew.interrupt();
	return json({ ok: true }, { headers: NO_STORE });
};
