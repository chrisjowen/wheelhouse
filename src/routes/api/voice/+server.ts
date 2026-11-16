import { json } from '@sveltejs/kit';
import { NO_STORE, readJson } from '$lib/server/http';
import { voiceService } from '$lib/server/voice/service';
import type { RequestHandler } from './$types';

/** Settings → Voice: who speaks and hears in Live mode, and whether each provider has its key. */
export const GET: RequestHandler = async () =>
	json(await voiceService().view(), { headers: NO_STORE });

export const POST: RequestHandler = async ({ request }) => {
	const read = await readJson(request, 2048);
	if (!read.ok) return read.response;
	return json(await voiceService().save(read.body), { headers: NO_STORE });
};
