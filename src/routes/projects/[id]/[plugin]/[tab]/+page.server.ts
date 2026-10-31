import { currentFleet, loadSlots } from '$lib/server/runtime';
import { repoUrl } from '$lib/server/repo';
import { slotKey } from '$lib/plugins/keys';
import type { PageServerLoad } from './$types';

// The project's plugin entries (the page shows the project.tab one it names) and its
// repository link, for the project's tab row.
export const load: PageServerLoad = async ({ params }) => {
	const fleet = await currentFleet();
	const project = fleet.projects.find((p) => p.id === params.id);
	return {
		slots: await loadSlots([slotKey.project(params.id)]),
		slotsAt: Date.now(),
		repo: project ? await repoUrl(project.path).catch(() => null) : null
	};
};
