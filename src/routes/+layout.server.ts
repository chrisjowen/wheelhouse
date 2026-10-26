import { currentFleet, currentHealth, currentHeadroom, loadSlots } from '$lib/server/runtime';
import { slotKey } from '$lib/plugins/keys';
import { sessionToken } from '$lib/server/session';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async () => ({
	fleet: await currentFleet(),
	health: await currentHealth(),
	// The header warns, from any page, only when an allowance will run out before it resets.
	atRisk: (await currentHeadroom()).atRisk,
	// Fleet plugin entries for the header on every page: menu pages and indicators.
	fleetSlots: await loadSlots([slotKey.fleet]),
	fleetSlotsAt: Date.now(),
	// Issued only to pages Wheelhouse serves; mutating requests must echo it.
	sessionToken: sessionToken()
});
