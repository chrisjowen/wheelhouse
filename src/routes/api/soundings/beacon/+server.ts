import { json } from '@sveltejs/kit';
import { NO_STORE, readJson } from '$lib/server/http';
import { getRuntime } from '$lib/server/runtime';
import type { RequestHandler } from './$types';

/**
 * Trouble Wheelhouse's own pages report (client/beacon.ts): a small batch at a
 * time, kept masked and within a rate limit (SoundingsService.receive).
 */
export const POST: RequestHandler = async ({ request }) => {
	const r = await getRuntime();
	if (!r.configured) return new Response(null, { status: 204 });
	const read = await readJson(request, 32 * 1024);
	if (!read.ok) return read.response;
	const taken = await r.soundings.receive(read.body.signals);
	return json({ taken }, { headers: NO_STORE });
};
