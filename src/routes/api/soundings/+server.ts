import { json } from '@sveltejs/kit';
import { NO_STORE, readJson } from '$lib/server/http';
import { getRuntime } from '$lib/server/runtime';
import type { RequestHandler } from './$types';

/**
 * Soundings (the experimental `soundings` feature; hooks.server.ts answers 404
 * while it is off): GET is what the Health page shows; POST asks for a scan
 * (`scan`) or a report (`report`) now, or mutes or unmutes a finding
 * (`mute`/`unmute` with its `id`). Nothing here stops or changes anything on
 * the computer.
 */
export const GET: RequestHandler = async () => {
	const r = await getRuntime();
	if (!r.configured) return json({ message: r.error }, { status: 503, headers: NO_STORE });
	return json(await r.soundings.view(), { headers: NO_STORE });
};

export const POST: RequestHandler = async ({ request }) => {
	const r = await getRuntime();
	if (!r.configured) return json({ message: r.error }, { status: 503, headers: NO_STORE });
	const read = await readJson(request, 4096);
	if (!read.ok) return read.response;
	const { action, id } = read.body;
	if (action === 'scan') await r.soundings.scan();
	else if (action === 'report') await r.soundings.report('manual');
	else if ((action === 'mute' || action === 'unmute') && typeof id === 'string' && id.length <= 400)
		await r.soundings.mute(id, action === 'mute');
	else
		return json(
			{ message: 'Choose scan, report, or mute or unmute with a finding id.' },
			{ status: 400, headers: NO_STORE }
		);
	return json(await r.soundings.view(), { headers: NO_STORE });
};
