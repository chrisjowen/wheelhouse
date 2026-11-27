import { error } from '@sveltejs/kit';
import { localDevPortal } from '$lib/server/cloud/local';
import type { PageServerLoad } from './$types';

/** A service's or an API's basics, how it touches the captain, and a question asked of the portal. */
export const load: PageServerLoad = async ({ params, url }) => {
	const portal = localDevPortal();
	const q = url.searchParams.get('q')?.trim().slice(0, 300) ?? '';
	const [record, answer] = await Promise.all([
		portal.record(params.team, params.id),
		q ? portal.ask(params.team, q) : null
	]);
	if (!record) error(404, 'Not found');
	return { team: params.team, record, q, answer };
};
