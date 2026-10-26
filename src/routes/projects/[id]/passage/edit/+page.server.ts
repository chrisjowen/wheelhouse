import { passageEditor } from '$lib/server/passages/view';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, url }) => {
	const target = url.searchParams.get('file') === 'captain' ? 'captain' : 'project';
	const r = await passageEditor(params.id, target);
	return r.ok
		? { editor: r.editor, tasks: r.tasks, problem: null }
		: { editor: null, tasks: [], problem: r.message };
};
