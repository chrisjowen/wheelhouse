import { featureSettings } from '$lib/server/features';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => ({
	hostedSecondMates: (await featureSettings())['hosted-second-mates']
});
