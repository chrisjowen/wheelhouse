import { defaultConfigDir } from '$lib/server/plugins/config';
import { featureSettings, readSavedFeatures } from '$lib/server/features';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => ({
	saved: await readSavedFeatures(defaultConfigDir(process.env)),
	enabled: await featureSettings()
});
