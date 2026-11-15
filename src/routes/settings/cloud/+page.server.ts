import { error, redirect } from '@sveltejs/kit';
import { REMOTES_LOCAL_ONLY, viaRelay } from '$lib/server/cloud/remote';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ request }) => {
	if (viaRelay(request)) error(403, REMOTES_LOCAL_ONLY);
	redirect(307, '/settings/gateway');
};
