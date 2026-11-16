import { getRuntime } from '$lib/server/runtime';
import type { PageServerLoad } from './$types';
export const load: PageServerLoad = async () => {
	const r = await getRuntime();
	return {
		events:
			r.configured && r.events && r.eventsConnection
				? { ...(await r.events.view()), ...(await r.eventsConnection.view()) }
				: null
	};
};
