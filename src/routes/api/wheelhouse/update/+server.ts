import { json } from '@sveltejs/kit';
import { NO_STORE } from '$lib/server/http';
import { updateService } from '$lib/server/upgrade/service';
import type { RequestHandler } from './$types';

/**
 * Whether Wheelhouse has a newer version on GitHub. GET answers with the last
 * check (starting another in the background when it is over six hours old)
 * and any upgrade under way; POST checks now (putting a failed upgrade behind
 * the captain) and answers once it has.
 */
export const GET: RequestHandler = async () =>
	json(await updateService().wheelhouse(), { headers: NO_STORE });

export const POST: RequestHandler = async () => {
	const s = updateService();
	await s.checkWheelhouseNow();
	return json(await s.wheelhouse(), { headers: NO_STORE });
};
