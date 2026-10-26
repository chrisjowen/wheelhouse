import { body, optString, start } from '$lib/server/prreview/http';
import type { RequestHandler } from './$types';

/** Ask the review agent about the PR, or one hunk of it: `{ question, hunk?, model?, effort? }`. */
export const POST: RequestHandler = async ({ params, request }) => {
	const b = await body(request);
	return start(params.id, (review, s) =>
		review.ask(s, {
			question: typeof b.question === 'string' ? b.question : '',
			hunk: optString(b.hunk) ?? null,
			model: optString(b.model),
			effort: optString(b.effort)
		})
	);
};
