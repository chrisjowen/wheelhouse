import { json } from '@sveltejs/kit';
import { NO_STORE, readJson } from '$lib/server/http';
import { voiceService } from '$lib/server/voice/service';
import type { RequestHandler } from './$types';

/** The longest line spoken in one call: the crew speaks a sentence at a time. */
const MAX_TEXT = 1200;

/**
 * One of the crew's sentences as audio from the chosen voice provider, the
 * key read from the vault here and never sent on. 204 when there is no
 * provider to use (none chosen, no key, or it failed): the page then speaks
 * the sentence with the browser's own voice.
 */
export const POST: RequestHandler = async ({ request }) => {
	const read = await readJson(request, 8192);
	if (!read.ok) return read.response;
	const { text, speed } = read.body;
	if (typeof text !== 'string' || !text.trim() || text.length > MAX_TEXT)
		return json({ message: 'Give a short text to speak.' }, { status: 400, headers: NO_STORE });
	const audio = await voiceService().speak(
		text.trim(),
		typeof speed === 'number' && Number.isFinite(speed) ? speed : 1,
		request.signal
	);
	if (!audio) return new Response(null, { status: 204, headers: NO_STORE });
	return new Response(audio.body, { headers: { ...NO_STORE, 'content-type': audio.type } });
};
