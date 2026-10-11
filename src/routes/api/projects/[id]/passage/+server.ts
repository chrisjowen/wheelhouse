import { json } from '@sveltejs/kit';
import { projectPassage } from '$lib/server/passages/view';
import type { RequestHandler } from './$types';

const headers = { 'cache-control': 'no-store' };

/** A project's passage: its passage files, steps, checks and the captain's consent. */
export const GET: RequestHandler = async ({ params }) => {
	const r = await projectPassage(params.id);
	return r.ok
		? json(r.view, { headers })
		: json({ message: r.message }, { status: r.status, headers });
};
