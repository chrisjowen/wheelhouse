import { json } from '@sveltejs/kit';
import { NO_STORE } from '$lib/server/http';
import { updateService } from '$lib/server/upgrade/service';
import type { RequestHandler } from './$types';

/**
 * Whether each installed plugin has something newer on GitHub. GET answers
 * with the last check (starting another when it is over six hours old); POST
 * checks now and answers once it has.
 */
export const GET: RequestHandler = async () =>
	json(await updateService().plugins(), { headers: NO_STORE });

export const POST: RequestHandler = async () => {
	const s = updateService();
	await s.checkPlugins();
	return json(await s.plugins(), { headers: NO_STORE });
};
