import { error } from '@sveltejs/kit';
import { getRuntime } from '$lib/server/runtime';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const r = await getRuntime();
	if (!r.configured) error(503, r.error);
	return { view: await r.soundings.view() };
};
