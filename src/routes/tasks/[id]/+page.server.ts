import { taskDetail } from '$lib/server/detail';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	const r = await taskDetail(params.id);
	return { id: params.id, detail: r.ok ? r.detail : null, problem: r.ok ? null : r.message };
};
