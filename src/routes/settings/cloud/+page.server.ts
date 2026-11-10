import { cloudSettings } from '$lib/server/cloud/local';
import { viaRelay } from '$lib/server/cloud/remote';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ request }) => ({
	view: await cloudSettings().view(viaRelay(request))
});
