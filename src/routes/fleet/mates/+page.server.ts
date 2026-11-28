import { featureSettings } from '$lib/server/features';
import type { PageServerLoad } from './$types';

/** Launching here is the hosted second mates wizard, which keeps its own flag. */
export const load: PageServerLoad = async () => ({
	hostedSecondMates: (await featureSettings())['hosted-second-mates']
});
