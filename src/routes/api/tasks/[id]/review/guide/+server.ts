import { body, optString, start } from '$lib/server/prreview/http';
import type { RequestHandler } from './$types';

/**
 * Write the review guide for the PR's current head: `{ force?, model?, effort? }`.
 * A guide already written for this head is returned as it is (no run) unless `force`.
 */
export const POST: RequestHandler = async ({ params, request }) => {
	const b = await body(request);
	return start(params.id, (review, s) =>
		review.startGuide(s, {
			force: b.force === true,
			model: optString(b.model),
			effort: optString(b.effort)
		})
	);
};
