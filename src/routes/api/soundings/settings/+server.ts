import { json } from '@sveltejs/kit';
import { NO_STORE, readJson } from '$lib/server/http';
import { getRuntime } from '$lib/server/runtime';
import type { RequestHandler } from './$types';

/** Save Soundings' settings: anything missing or out of range takes its default (lib/soundings.ts). */
export const POST: RequestHandler = async ({ request }) => {
	const r = await getRuntime();
	if (!r.configured) return json({ message: r.error }, { status: 503, headers: NO_STORE });
	const read = await readJson(request, 16 * 1024);
	if (!read.ok) return read.response;
	try {
		return json({ settings: await r.soundings.saveSettings(read.body) }, { headers: NO_STORE });
	} catch (error) {
		return json({ message: (error as Error).message }, { status: 500, headers: NO_STORE });
	}
};
