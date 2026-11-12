import { json } from '@sveltejs/kit';
import { NO_STORE } from '$lib/server/http';
import { marketplaceService } from '$lib/server/plugins/marketplace-service';
import type { RequestHandler } from './$types';

/**
 * The plugin marketplace: the plugins the configured registries list that are
 * not installed, with each registry's state. `?refresh=1` reads the registries
 * again now instead of answering with what was read in the last few minutes.
 * Reading a registry changes nothing here; installing goes through
 * /api/plugins/inspect and /api/plugins/install, as any plugin does.
 */
export const GET: RequestHandler = async ({ url }) =>
	json(await marketplaceService().view({ refresh: url.searchParams.get('refresh') === '1' }), {
		headers: NO_STORE
	});
