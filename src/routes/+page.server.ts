import { currentRailInsights, loadSlots } from '$lib/server/runtime';
import { slotKey } from '$lib/plugins/keys';
import type { PageServerLoad } from './$types';

// Plugin entries for the fleet: bridge.card cards follow Firstmate's replies that link them.
// The rail's insights come with the page, then refresh in the browser.
export const load: PageServerLoad = async () => ({
	slots: await loadSlots([slotKey.fleet]),
	slotsAt: Date.now(),
	insights: await currentRailInsights()
});
