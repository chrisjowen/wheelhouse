import { json } from '@sveltejs/kit';
import { NO_STORE } from '$lib/server/http';
import { voiceService } from '$lib/server/voice/service';
import type { RequestHandler } from './$types';

/** About two minutes of compressed speech; push to talk clips are far shorter. */
const MAX_BYTES = 4 * 1024 * 1024;

/**
 * A clip of the captain talking, heard by the chosen provider with the
 * fleet's names as key terms. `{ text: null }` when there is no provider to
 * use: the page keeps what the browser heard.
 */
export const POST: RequestHandler = async ({ request, url }) => {
	const type = (request.headers.get('content-type') ?? '').split(';')[0].trim();
	if (!type.startsWith('audio/'))
		return json({ message: 'Send the clip as audio.' }, { status: 415, headers: NO_STORE });
	const audio = new Uint8Array(await request.arrayBuffer());
	if (audio.byteLength > MAX_BYTES)
		return json({ message: 'The clip is too long.' }, { status: 413, headers: NO_STORE });
	if (audio.byteLength < 1000) return json({ text: null }, { headers: NO_STORE });
	const from = Math.max(0, Number(url.searchParams.get('from')) || 0);
	const text = await voiceService().hear(audio, type, from, request.signal);
	return json({ text }, { headers: NO_STORE });
};
