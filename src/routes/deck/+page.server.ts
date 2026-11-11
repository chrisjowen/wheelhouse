import { currentRailInsights, loadSlots } from '$lib/server/runtime';
import { slotKey } from '$lib/plugins/keys';
import type { PageServerLoad } from './$types';

// The same as the home page's: plugin home.card entries for the rail, and its insights.
export const load: PageServerLoad = async () => ({
	slots: await loadSlots([slotKey.fleet]),
	slotsAt: Date.now(),
	insights: await currentRailInsights()
});
