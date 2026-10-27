import { currentPlugins, loadSlots } from '$lib/server/runtime';
import { slotKey } from '$lib/plugins/keys';
import type { PageServerLoad } from './$types';

// The fleet's plugin entries; the page shows the nav.page one it names, else
// how to install the plugin it belongs to, when the home uses one not installed.
export const load: PageServerLoad = async ({ params }) => ({
	slots: await loadSlots([slotKey.fleet]),
	slotsAt: Date.now(),
	suggested: (await currentPlugins()).suggested.find((s) => s.id === params.plugin) ?? null
});
