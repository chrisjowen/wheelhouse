import { json } from '@sveltejs/kit';
import { currentFleet } from '$lib/server/runtime';
import { NO_STORE } from '$lib/server/http';
import { previewProber } from '$lib/server/preview';
import { servedOrigin } from '$lib/server/session';
import type { RequestHandler } from './$types';

/**
 * Whether the task's reported preview can be shown embedded right now (see
 * lib/server/preview.ts). Only loopback previews are ever fetched.
 */
export const GET: RequestHandler = async ({ params, request }) => {
	const task = (await currentFleet()).tasks.find((t) => t.id === params.id);
	if (!task) return json({ message: 'No such task.' }, { status: 404, headers: NO_STORE });
	return json(await previewProber().check(task.preview, servedOrigin(request)), {
		headers: NO_STORE
	});
};
