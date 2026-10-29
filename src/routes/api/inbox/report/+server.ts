import { readFile } from 'node:fs/promises';
import { error } from '@sveltejs/kit';
import { getRuntime } from '$lib/server/runtime';
import type { RequestHandler } from './$types';

/**
 * The report an open decision card names (`?card=<card id>`), as Markdown
 * text: only a .md file inside Firstmate's data folder (InboxService.reportFile).
 */
export const GET: RequestHandler = async ({ url }) => {
	const runtime = await getRuntime();
	if (!runtime.configured) error(503, runtime.error);
	const card = url.searchParams.get('card');
	const file = card ? await runtime.inbox.reportFile(card) : null;
	if (!file) error(404, 'Not found');
	const text = await readFile(file, 'utf8').catch(() => null);
	if (text === null) error(404, 'Not found');
	return new Response(text, {
		headers: {
			'content-type': 'text/plain; charset=utf-8',
			'cache-control': 'no-store',
			'x-content-type-options': 'nosniff'
		}
	});
};
