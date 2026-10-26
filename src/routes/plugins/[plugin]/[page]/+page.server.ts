import { loadSlots } from '$lib/server/runtime';
import { slotKey } from '$lib/plugins/keys';
import type { PageServerLoad } from './$types';

// The fleet's plugin entries; the page shows the nav.page one it names.
export const load: PageServerLoad = async () => ({
	slots: await loadSlots([slotKey.fleet]),
	slotsAt: Date.now()
});
