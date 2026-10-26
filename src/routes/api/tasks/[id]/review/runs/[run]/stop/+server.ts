import { error, json } from '@sveltejs/kit';
import { getRuntime } from '$lib/server/runtime';
import type { RequestHandler } from './$types';

/** Stop one of the task's review agent runs while it is going. */
export const POST: RequestHandler = async ({ params }) => {
	const runtime = await getRuntime();
	if (!runtime.configured) error(503, runtime.error);
	if (!runtime.review.stop(params.id, params.run)) error(404, 'That run is not going.');
	return json({ stopped: true });
};
