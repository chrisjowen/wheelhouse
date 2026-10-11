import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { error } from '@sveltejs/kit';
import { getRuntime } from '$lib/server/runtime';
import type { RequestHandler } from './$types';

const TYPES: Record<string, string> = {
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.webp': 'image/webp',
	'.gif': 'image/gif'
};
const MAX_BYTES = 15 * 1024 * 1024;

/** Serves a task's screenshots only: the name must be one the evidence reader listed. */
export const GET: RequestHandler = async ({ params }) => {
	const runtime = await getRuntime();
	if (!runtime.configured) error(503, runtime.error);
	const runIds = runtime.collector.ledgerTask(params.id)?.runIds ?? [];
	const file = await runtime.evidence.artifactFile(params.id, params.name, runIds);
	if (!file) error(404, 'Not found');
	const type = TYPES[path.extname(file).toLowerCase()];
	const st = await stat(file).catch(() => null);
	if (!type || !st?.isFile() || st.size > MAX_BYTES) error(404, 'Not found');
	return new Response(new Uint8Array(await readFile(file)), {
		headers: {
			'content-type': type,
			'cache-control': 'private, max-age=60',
			'x-content-type-options': 'nosniff'
		}
	});
};
