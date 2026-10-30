import { json } from '@sveltejs/kit';
import { NO_STORE } from '$lib/server/http';
import { asSentence, refuse } from '$lib/server/upgrade/requests';
import { updateService } from '$lib/server/upgrade/service';
import type { RequestHandler } from './$types';

/**
 * Turn an installed plugin that is off back on, and restart Wheelhouse to
 * load it: Wheelhouse loads plugins only when it starts.
 */
export const POST: RequestHandler = async ({ params }) => {
	const r = await updateService().loadPlugin(params.plugin);
	if (!r.ok) return refuse(asSentence(r.error), 409);
	return json(r, { headers: NO_STORE });
};
