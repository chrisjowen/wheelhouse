import { error } from '@sveltejs/kit';
import { readFile } from 'node:fs/promises';
import { getRuntime } from '$lib/server/runtime';
import type { RequestHandler } from './$types';

/**
 * One file a record holds (its report, or a file the report links), served so
 * that it can never run: HTML is sandboxed with scripts off, nothing is sniffed.
 */
export const GET: RequestHandler = async ({ params }) => {
	const runtime = await getRuntime();
	if (!runtime.configured) error(503, runtime.error);
	const f = await runtime.documents.recordFile(`${params.project}/${params.task}`, params.path);
	if (!f) error(404, 'The record holds no such file.');
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
