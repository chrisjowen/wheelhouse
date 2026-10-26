import { reviewSubject } from '$lib/server/detail';
import type { ReviewView } from '$lib/prreview';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	const r = await reviewSubject(params.id);
	const view: ReviewView = r.ok
		? await r.runtime.review.view(r.subject)
		: { schema: 'wheelhouse-pr-review.v1', available: false, taskId: params.id, reason: r.message };
	return { id: params.id, view, title: r.ok ? r.subject.task.title : null };
};
