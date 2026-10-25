import { loadSlots } from '$lib/server/runtime';
import { slotKey } from '$lib/plugins/keys';
import type { PageServerLoad } from './$types';

// The project's plugin entries; the page shows the project.tab one it names.
export const load: PageServerLoad = async ({ params }) => ({
	slots: await loadSlots([slotKey.project(params.id)]),
	slotsAt: Date.now()
});
