import { featureSettings } from '$lib/server/features';
import { remotesPage } from '$lib/server/cloud/page';
import type { PageServerLoad } from './$types';

/** The Overview's Remotes card: whether remote access is started, while its flag is on. */
export const load: PageServerLoad = async ({ request }) => ({
	remote: (await featureSettings()).remotes ? (await remotesPage(request)).view : null
});
