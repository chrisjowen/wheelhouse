import { taskDoc } from '$lib/server/detail';
import type { PageServerLoad } from './$types';

const MAX_PATH = 1024;

/** One doc or decision record the task's session read or changed (only one its Docs list names). */
export const load: PageServerLoad = async ({ params, url }) => {
	const file = url.searchParams.get('path') ?? '';
	if (!file || file.length > MAX_PATH) {
		return { id: params.id, task: null, doc: null, problem: 'No document was named.' };
	}
	const r = await taskDoc(params.id, file);
	return r.ok
		? {
				id: params.id,
				task: { title: r.task.shortTitle, projectId: r.task.projectId },
				doc: r.doc,
				problem: null
			}
		: { id: params.id, task: null, doc: null, problem: r.message };
};
