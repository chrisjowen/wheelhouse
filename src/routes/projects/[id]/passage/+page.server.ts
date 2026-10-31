import { projectPassage } from '$lib/server/passages/view';
import { currentFleet, loadSlots } from '$lib/server/runtime';
import { repoUrl } from '$lib/server/repo';
import { slotKey } from '$lib/plugins/keys';
import type { PageServerLoad } from './$types';

// How the project's passage is defined, and what its banner needs: its repository link
// and its plugin tabs.
export const load: PageServerLoad = async ({ params }) => {
	const [r, fleet, slots] = await Promise.all([
		projectPassage(params.id),
		currentFleet(),
		loadSlots([slotKey.project(params.id)])
	]);
	const project = fleet.projects.find((p) => p.id === params.id);
	return {
		...(r.ok ? { view: r.view, problem: null } : { view: null, problem: r.message }),
		repo: project ? await repoUrl(project.path).catch(() => null) : null,
		slots,
		slotsAt: Date.now()
	};
};
