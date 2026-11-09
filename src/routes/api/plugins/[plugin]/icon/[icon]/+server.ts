import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { error } from '@sveltejs/kit';
import { ICON_TYPES } from '$lib/server/plugins/manifest';
import { pluginIconFile } from '$lib/server/runtime';
import type { RequestHandler } from './$types';

/**
 * A loaded plugin's menu icon, at `<contribution><extension>`: the one image
 * file its manifest names for that nav.page contribution (`icon`), and nothing
 * else of the plugin's.
 */
export const GET: RequestHandler = async ({ params }) => {
	const ext = path.extname(params.icon);
	const file = await pluginIconFile(params.plugin, params.icon.slice(0, -ext.length || undefined));
	const type = file ? ICON_TYPES[ext.toLowerCase()] : undefined;
	if (!file || !type || path.extname(file).toLowerCase() !== ext.toLowerCase()) {
		error(404, 'No such plugin icon.');
	}
	return new Response(await readFile(file), {
		headers: {
			'content-type': type,
			'cache-control': 'no-cache',
			'x-content-type-options': 'nosniff',
			// An SVG opened on its own runs no script and loads nothing.
			'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox"
		}
	});
};
