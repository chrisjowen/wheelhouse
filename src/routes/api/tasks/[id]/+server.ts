import { error, json } from '@sveltejs/kit';
import { taskDetail } from '$lib/server/detail';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params }) => {
	const r = await taskDetail(params.id);
	if (!r.ok) error(r.status, r.message);
	return json(r.detail, { headers: { 'cache-control': 'no-store' } });
};
