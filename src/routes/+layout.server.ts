import { currentFleet, currentHealth, currentHeadroom } from '$lib/server/runtime';
import { sessionToken } from '$lib/server/session';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async () => ({
	fleet: await currentFleet(),
	health: await currentHealth(),
	// The header warns, from any page, only when an allowance will run out before it resets.
	atRisk: (await currentHeadroom()).atRisk,
	// Issued only to pages Wheelhouse serves; mutating requests must echo it.
	sessionToken: sessionToken()
});
