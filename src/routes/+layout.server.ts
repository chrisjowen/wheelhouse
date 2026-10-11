import { currentFleet, currentHealth } from '$lib/server/runtime';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async () => ({
	fleet: await currentFleet(),
	health: await currentHealth()
});
