import { error } from '@sveltejs/kit';
import { readAsset } from '$lib/server/files/docfile';
import { currentFileRoots } from '$lib/server/runtime';
import type { RequestHandler } from './$types';

/**
 * An image a document in the reader shows or links to, from inside the
 * folders Wheelhouse may read (see server/files/docfile.ts). Served so that it
 * can never run as a page: no sniffing, and a sandbox for anything opened directly.
 */
export const GET: RequestHandler = async ({ url }) => {
	const roots = await currentFileRoots();
	if (!roots) error(503, 'Firstmate is not set up.');
	const r = await readAsset(url.searchParams.get('path') ?? '', roots);
	if (!r.ok) error(r.status, r.message);
	return new Response(new Uint8Array(r.data), {
		headers: {
			'content-type': r.type,
			'cache-control': 'private, no-cache',
			'x-content-type-options': 'nosniff',
			'content-security-policy':
				"default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox"
		}
	});
};
