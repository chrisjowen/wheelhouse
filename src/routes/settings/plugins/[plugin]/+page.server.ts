import { error } from '@sveltejs/kit';
import { canRestart } from '$lib/server/restart';
import { currentPluginPage } from '$lib/server/runtime';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	const view = await currentPluginPage(params.plugin);
	if (!view) error(404, 'Wheelhouse has no such plugin.');
	return { view, canRestart: canRestart() };
};
