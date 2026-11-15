import { redirect } from '@sveltejs/kit';
import { featureSettings } from '$lib/server/features';
import type { PageServerLoad } from './$types';

// Settings opens on its first remaining page, which remains reachable when Remotes is off.
export const load: PageServerLoad = async () =>
	redirect(307, (await featureSettings()).remotes ? '/settings/cloud' : '/settings/experimental');
