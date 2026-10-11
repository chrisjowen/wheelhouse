import { projectPassage } from '$lib/server/passages/view';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	const r = await projectPassage(params.id);
	return r.ok ? { view: r.view, problem: null } : { view: null, problem: r.message };
};
