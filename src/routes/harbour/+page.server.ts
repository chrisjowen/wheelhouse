import { currentFleet, loadSlots } from '$lib/server/runtime';
import { slotKey } from '$lib/plugins/keys';
import type { PageServerLoad } from './$types';

// Plugin entries for each project's tab and Harbour cards.
export const load: PageServerLoad = async () => {
	const fleet = await currentFleet();
	return {
		slots: await loadSlots(fleet.projects.map((p) => slotKey.project(p.id))),
		slotsAt: Date.now()
	};
};
