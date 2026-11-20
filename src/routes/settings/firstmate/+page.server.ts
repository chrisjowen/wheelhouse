import { getRuntime } from '$lib/server/runtime';
import {
	readFirstmateSettings,
	unavailableFirstmateSettings
} from '$lib/server/firstmate/settings';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const runtime = await getRuntime();
	if (!runtime.configured) {
		return { view: unavailableFirstmateSettings(runtime.error), canAsk: false };
	}
	return {
		view: await readFirstmateSettings(runtime.install),
		canAsk: runtime.messenger?.available ?? false
	};
};
