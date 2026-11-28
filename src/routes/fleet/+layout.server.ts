import { fleetPage } from '$lib/server/cloud/page';
import type { LayoutServerLoad } from './$types';

/** The fleet this ship is in, for the row's locked tabs and the Overview (as Settings → Fleet). */
export const load: LayoutServerLoad = async ({ request }) => {
	const { view, gateway } = await fleetPage(request);
	return { membership: view, relayGateway: gateway };
};
