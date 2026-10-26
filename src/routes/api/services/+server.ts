import { error, json } from '@sveltejs/kit';
import { NO_STORE, readJson } from '$lib/server/http';
import { pluginService } from '$lib/server/runtime';
import type { RequestHandler } from './$types';

/**
 * A plugin's companion service. GET `?plugin=&service=[&project=]` says whether
 * it is up; POST `{ plugin, service, project? }` starts it, only on the
 * captain's click (the session token and Origin are checked for every POST),
 * and answers once it is up or has failed.
 */
const query = (o: Record<string, unknown>) => {
	const str = (v: unknown) => (typeof v === 'string' && v ? v : null);
	const plugin = str(o.plugin);
	const service = str(o.service);
	if (!plugin || !service) error(400, 'Name a plugin and a service.');
	return { plugin, service, project: str(o.project) };
};

export const GET: RequestHandler = async ({ url }) => {
	const view = await pluginService(query(Object.fromEntries(url.searchParams)));
	if (!view) error(404, 'No such service here.');
	return json(view, { headers: NO_STORE });
};

export const POST: RequestHandler = async ({ request }) => {
	const body = await readJson(request, 4 * 1024);
	if (!body.ok) return body.response;
	const view = await pluginService(query(body.body), true);
	if (!view) error(404, 'No such service here.');
	return json(view, { headers: NO_STORE });
};
