import { error } from '@sveltejs/kit';
import { readFile } from 'node:fs/promises';
import { getRuntime } from '$lib/server/runtime';
import type { RequestHandler } from './$types';

/** A file beside a library document (an image it shows), served so that it can never run. */
export const GET: RequestHandler = async ({ params }) => {
	const runtime = await getRuntime();
	if (!runtime.configured) error(503, runtime.error);
	const f = await runtime.documents.libraryFile(
		`${params.shelf}/${params.folder}/${params.slug}`,
		params.path
	);
	if (!f) error(404, 'The library holds no such file.');
	return new Response(new Uint8Array(await readFile(f.file)), {
		headers: {
			'content-type': f.type,
			'cache-control': 'private, no-cache',
			'x-content-type-options': 'nosniff',
			'content-security-policy':
				"default-src 'none'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; sandbox"
		}
	});
};
