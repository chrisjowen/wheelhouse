import { currentFleet, loadSlots } from '$lib/server/runtime';
import { slotKey } from '$lib/plugins/keys';
import { BOARD_VIEWS, VIEW_COOKIE, viewOf } from '$lib/views';
import type { PageServerLoad } from './$types';

// Plugin entries for each project's tab and Harbour cards, and the remembered layout.
export const load: PageServerLoad = async ({ cookies }) => {
	const fleet = await currentFleet();
	return {
		slots: await loadSlots(fleet.projects.map((p) => slotKey.project(p.id))),
		slotsAt: Date.now(),
		layout: viewOf(cookies.get(VIEW_COOKIE.harbour), BOARD_VIEWS)
	};
};
