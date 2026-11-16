import { json } from '@sveltejs/kit';
import { REMOTES_LOCAL_ONLY, viaRelay } from '$lib/server/cloud/remote';
import { defaultConfigDir } from '$lib/server/plugins/config';
import {
	FEATURE_FLAGS,
	FEATURE_SETTINGS,
	featureSettings,
	readSavedFeatures,
	saveFeatureSettings,
	type FeatureFlag
} from '$lib/server/features';
import { NO_STORE, readJson } from '$lib/server/http';
import { restartSoon } from '$lib/server/restart';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () =>
	json(
		{
			saved: await readSavedFeatures(defaultConfigDir(process.env)),
			enabled: await featureSettings()
		},
		{ headers: NO_STORE }
	);

export const POST: RequestHandler = async ({ request }) => {
	const read = await readJson(request, 4096);
	if (!read.ok) return read.response;
	const { feature, enabled } = read.body;
	if (
		typeof feature !== 'string' ||
		!FEATURE_SETTINGS.includes(feature as FeatureFlag) ||
		typeof enabled !== 'boolean'
	) {
		return json(
			{
				message: `Choose ${FEATURE_FLAGS.join(', ')}, or automaticProviderSwitching, and set enabled to true or false.`
			},
			{ status: 400, headers: NO_STORE }
		);
	}
	if (feature === 'remotes' && viaRelay(request)) {
		return json({ message: REMOTES_LOCAL_ONLY }, { status: 403, headers: NO_STORE });
	}
	const saved = await readSavedFeatures(defaultConfigDir(process.env));
	saved[feature as FeatureFlag] = enabled;
	try {
		await saveFeatureSettings(defaultConfigDir(process.env), saved);
	} catch (error) {
		return json({ message: (error as Error).message }, { status: 500, headers: NO_STORE });
	}
	const restartRequired = feature === 'automaticProviderSwitching' ? false : restartSoon();
	if (restartRequired) process.send?.({ type: 'features-changed' });
	return json({ saved, enabled: await featureSettings(), restartRequired }, { headers: NO_STORE });
};
