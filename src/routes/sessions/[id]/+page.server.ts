import { error } from '@sveltejs/kit';
import { getRuntime } from '$lib/server/runtime';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	const runtime = await getRuntime();
	if (!runtime.configured) error(503, runtime.error);
	const session = await runtime.sessions.get(params.id);
	if (!session) error(404, `There is no session called ${params.id}.`);
	return { session };
};
