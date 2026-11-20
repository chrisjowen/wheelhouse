import { redirect } from '@sveltejs/kit';
import { featureSettings } from '$lib/server/features';
import type { PageServerLoad } from './$types';

// Settings opens on Gateway when Remotes is enabled, else on its first available page.
export const load: PageServerLoad = async () =>
	redirect(307, (await featureSettings()).remotes ? '/settings/gateway' : '/settings/experimental');
