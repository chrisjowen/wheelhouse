import { json } from '@sveltejs/kit';
import { NO_STORE, readJson } from '$lib/server/http';
import { liveSession } from '$lib/server/live/sessions';
import type { RequestHandler } from './$types';

/** What the captain just said; any answer in progress stops and this one is answered next. */
export const POST: RequestHandler = async ({ params, request }) => {
	const session = liveSession(params.id);
	if (!session) return json({ message: 'No such discussion.' }, { status: 404, headers: NO_STORE });
	const read = await readJson(request, 16 * 1024);
	if (!read.ok) return read.response;
	const text = typeof read.body.text === 'string' ? read.body.text.trim() : '';
	if (!text) return json({ message: 'Say something.' }, { status: 400, headers: NO_STORE });
	return json({ turn: session.crew.say(text.slice(0, 8000)) }, { headers: NO_STORE });
};
