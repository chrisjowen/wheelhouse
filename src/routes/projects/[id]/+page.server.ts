import { currentFleet, loadSlots } from '$lib/server/runtime';
import { repoUrl } from '$lib/server/repo';
import { slotKey } from '$lib/plugins/keys';
import { BOARD_VIEWS, VIEW_COOKIE, viewOf } from '$lib/views';
import type { PageServerLoad } from './$types';

// A project's own page: its repository link, its plugin tabs and cards, and the
// remembered layout of its work.
export const load: PageServerLoad = async ({ params, cookies }) => {
	const fleet = await currentFleet();
	const project = fleet.projects.find((p) => p.id === params.id);
	return {
		repo: project ? await repoUrl(project.path).catch(() => null) : null,
		slots: await loadSlots([slotKey.project(params.id)]),
		slotsAt: Date.now(),
		layout: viewOf(cookies.get(VIEW_COOKIE.harbour), BOARD_VIEWS)
	};
};
