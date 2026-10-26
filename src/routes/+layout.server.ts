import { currentFleet, currentHealth, currentHeadroom, currentInbox } from '$lib/server/runtime';
import { sessionToken } from '$lib/server/session';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async () => ({
	fleet: await currentFleet(),
	health: await currentHealth(),
	// The header warns, from any page, only when an allowance will run out before it resets.
	atRisk: (await currentHeadroom()).atRisk,
	// The decision inbox: the header's count and the home rail's stack, then live in the browser.
	inbox: await currentInbox(),
	// Issued only to pages Wheelhouse serves; mutating requests must echo it.
	sessionToken: sessionToken()
});
