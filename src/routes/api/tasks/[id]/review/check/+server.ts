import { body, optString, start } from '$lib/server/prreview/http';
import type { RequestHandler } from './$types';

/** Ask the review agent for a focused review of the PR, or one hunk: `{ hunk?, model?, effort? }`. */
export const POST: RequestHandler = async ({ params, request }) => {
	const b = await body(request);
	return start(params.id, (review, s) =>
		review.review(s, {
			hunk: optString(b.hunk) ?? null,
			model: optString(b.model),
			effort: optString(b.effort)
		})
	);
};
