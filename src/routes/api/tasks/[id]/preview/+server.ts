import { json } from '@sveltejs/kit';
import { currentFleet, getRuntime } from '$lib/server/runtime';
import { parseMateTaskId } from '$lib/server/firstmate/matetasks';
import { NO_STORE } from '$lib/server/http';
import { previewProber } from '$lib/server/preview';
import { servedOrigin } from '$lib/server/session';
import type { RequestHandler } from './$types';

/**
 * Whether the task's reported preview can be shown embedded right now (see
 * lib/server/preview.ts). Only loopback previews are ever fetched.
 */
export const GET: RequestHandler = async ({ params, request }) => {
	// A second mate's task (`<task>@<mate>`): its preview, through a forward for a remote one.
	if (parseMateTaskId(params.id)) {
		const runtime = await getRuntime();
		if (!runtime.configured)
			return json({ message: runtime.error }, { status: 503, headers: NO_STORE });
		const found = runtime.mateTasks.find(params.id);
		if (!found.ok)
			return json({ message: found.error }, { status: found.status, headers: NO_STORE });
		return json(await runtime.mateTasks.preview(params.id, servedOrigin(request)), {
			headers: NO_STORE
		});
	}
	const task = (await currentFleet()).tasks.find((t) => t.id === params.id);
	if (!task) return json({ message: 'No such task.' }, { status: 404, headers: NO_STORE });
	const check = await previewProber().check(task.preview, servedOrigin(request), {
		landed: task.status === 'landed'
	});
	return json(check, { headers: NO_STORE });
};
