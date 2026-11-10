import { error } from '@sveltejs/kit';
import { setupService } from '$lib/server/setup/service';
import { refusesSetup } from '$lib/server/setup/terminal';
import type { PageServerLoad } from './$types';

// The setup wizard: only for a browser on this computer, never through Wheelhouse Cloud.
export const load: PageServerLoad = async ({ request, getClientAddress }) => {
	if (refusesSetup(getClientAddress(), request.headers.get('x-wheelhouse-remote'))) {
		error(403, 'Setup only runs on this computer.');
	}
	return { setup: await setupService().view() };
};
