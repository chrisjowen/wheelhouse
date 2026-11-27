import { error, redirect } from '@sveltejs/kit';
import { localDevPortal } from '$lib/server/cloud/local';
import { portalHref } from '$lib/portal';
import type { PageServerLoad } from './$types';

/**
 * The dev portal's own page: the captain's teams that have one, straight to
 * the team when there is only one. Not there while this ship is not in a fleet
 * whose dev portal is on for it.
 */
export const load: PageServerLoad = async () => {
	const teams = await localDevPortal().teams();
	if (!teams) error(404, 'Not found');
	if (teams.ok && teams.value.length === 1) redirect(307, portalHref(teams.value[0].slug));
	return { teams };
};
