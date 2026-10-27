import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { error } from '@sveltejs/kit';
import { pluginUiFile } from '$lib/server/runtime';
import type { RequestHandler } from './$types';

/**
 * An installed plugin's UI bundle (and the files beside it, such as split
 * chunks or a stylesheet), which the page imports to define the plugin's
 * custom elements. Only files under the directory of the manifest's `ui` entry.
 */
const TYPES: Record<string, string> = {
	'.js': 'text/javascript; charset=utf-8',
	'.mjs': 'text/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.json': 'application/json',
	'.map': 'application/json',
	'.svg': 'image/svg+xml',
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.webp': 'image/webp',
	'.woff2': 'font/woff2'
};

export const GET: RequestHandler = async ({ params }) => {
	const type = TYPES[path.extname(params.path).toLowerCase()];
	const file = type ? await pluginUiFile(params.plugin, params.path) : null;
	if (!file) error(404, 'No such plugin file.');
	return new Response(await readFile(file), {
		headers: {
			'content-type': type,
			'cache-control': 'no-cache',
			'x-content-type-options': 'nosniff'
		}
	});
};
