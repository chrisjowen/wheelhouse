import { redirect } from '@sveltejs/kit';
import { remotesPage } from '$lib/server/cloud/page';
import { viaRelay } from '$lib/server/cloud/remote';
import type { PageServerLoad } from './$types';

// Settings → Gateway became Settings → Fleet, but a session already reached
// through the relay still lands on this URL and must see the same no-controls
// status as every other page the relay carries, not a redirect or a refusal.
export const load: PageServerLoad = (event) => {
	if (viaRelay(event.request)) return remotesPage(event.request);
	redirect(307, '/settings/fleet');
};
