import { error, json } from '@sveltejs/kit';
import { currentSlots } from '$lib/server/runtime';
import type { RequestHandler } from './$types';

/** Plugin entries: `?task=<id>`, `?project=<id>`, or neither for the fleet (Bridge cards). */
export const GET: RequestHandler = async ({ url }) => {
	const task = url.searchParams.get('task');
	const project = url.searchParams.get('project');
	if (task !== null && project !== null) error(400, 'Ask for a task or a project, not both.');
	const view = await currentSlots(
		task !== null
			? { scope: 'task', taskId: task }
			: project !== null
				? { scope: 'project', projectId: project }
				: { scope: 'fleet' }
	);
	return json(view, { headers: { 'cache-control': 'no-store' } });
};
