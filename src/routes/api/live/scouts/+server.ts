import { json } from '@sveltejs/kit';
import { NO_STORE } from '$lib/server/http';
import { currentFleet, getRuntime } from '$lib/server/runtime';
import { findScouts, type ScoutLookup } from '$lib/server/live/scouts';
import type { RequestHandler } from './$types';

/**
 * The scouts a Live mode discussion asked Firstmate for, by reference
 * (`?scout=<ref>:<sent at, epoch ms>`, repeated): each one's task once
 * Firstmate has dispatched it, and its report once written; null while
 * nothing matches yet. Read only.
 */
export const GET: RequestHandler = async ({ url }) => {
	const runtime = await getRuntime();
	if (!runtime.configured)
		return json({ message: runtime.error }, { status: 503, headers: NO_STORE });
	const lookups: ScoutLookup[] = url.searchParams
		.getAll('scout')
		.slice(0, 12)
		.map((v) => {
			const [ref, at] = v.split(':');
			return { ref, since: Number(at) || 0 };
		});
	if (!lookups.length) return json({ scouts: {} }, { headers: NO_STORE });
	const fleet = await currentFleet();
	return json(
		{ scouts: await findScouts(runtime.install.homeDir, fleet.tasks, lookups) },
		{ headers: NO_STORE }
	);
};
