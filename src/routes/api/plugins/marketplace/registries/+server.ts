import { json } from '@sveltejs/kit';
import { NO_STORE, readJson } from '$lib/server/http';
import { marketplaceService } from '$lib/server/plugins/marketplace-service';
import { refuse } from '$lib/server/upgrade/requests';
import type { RequestHandler } from './$types';

/**
 * Change which plugin registries the marketplace reads, kept in
 * `plugin-registries.json`: `{ "add": "org/repo" }` (or a GitHub address) clones
 * the repository and adds it when it holds a registry Wheelhouse can read;
 * `{ "remove": "<registry id>" }` removes one and forgets its clone. Answers with
 * the marketplace as it now stands.
 */
export const POST: RequestHandler = async ({ request }) => {
	const body = await readJson(request, 4 * 1024);
	if (!body.ok) return body.response;
	const m = marketplaceService();
	const r =
		body.body.add !== undefined
			? await m.addRegistry(body.body.add)
			: body.body.remove !== undefined
				? await m.removeRegistry(body.body.remove)
				: ({ ok: false, error: 'Say which registry to add or remove.' } as const);
	if (!r.ok) return refuse(r.error);
	return json(await m.view(), { headers: NO_STORE });
};
