import { error } from '@sveltejs/kit';
import { localDevPortal } from '$lib/server/cloud/local';
import type { PageServerLoad } from './$types';

/** A team's dev portal basics: what the captain owns, what crews filed lately, and a question. */
export const load: PageServerLoad = async ({ params, url }) => {
	const portal = localDevPortal();
	const q = url.searchParams.get('q')?.trim().slice(0, 300) ?? '';
	const [overview, answer] = await Promise.all([
		portal.overview(params.team),
		q ? portal.ask(params.team, q) : null
	]);
	if (!overview) error(404, 'Not found');
	return { team: params.team, overview, q, answer };
};
