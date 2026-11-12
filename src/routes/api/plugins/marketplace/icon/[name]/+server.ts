import { error } from '@sveltejs/kit';
import { marketplaceService } from '$lib/server/plugins/marketplace-service';
import type { RequestHandler } from './$types';

/**
 * A plugin's icon as a registry names it, fetched by Wheelhouse, so the page
 * never loads from a registry's hosts itself, and an SVG (which GitHub serves
 * as plain text) is drawn as an image.
 */
export const GET: RequestHandler = async ({ params }) => {
	const icon = await marketplaceService().icon(params.name);
	if (!icon) error(404, 'No such icon.');
	return new Response(icon.body as BodyInit, {
		headers: {
			'content-type': icon.type,
			'cache-control': 'private, max-age=600',
			'x-content-type-options': 'nosniff',
			// An SVG opened on its own runs no script and loads nothing.
			'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox"
		}
	});
};
