import { error, json } from '@sveltejs/kit';
import { reviewSubject } from '$lib/server/detail';
import type { RequestHandler } from './$types';

/**
 * The task's pull request for review: its diff as files and hunks, the guide
 * the review agent wrote for this head (when it has run), and the questions and
 * reviews asked so far. Read-only; nothing runs the agent here.
 */
export const GET: RequestHandler = async ({ params }) => {
	const r = await reviewSubject(params.id);
	if (!r.ok) error(r.status, r.message);
	return json(await r.runtime.review.view(r.subject), {
		headers: { 'cache-control': 'no-store' }
	});
};
