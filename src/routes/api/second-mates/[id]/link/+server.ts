import { error, json } from '@sveltejs/kit';
import { getRuntime } from '$lib/server/runtime';
import type { RequestHandler } from './$types';

/**
 * The link to a second mate on a Fleetyard machine (lib/server/firstmate/matelink.ts).
 * GET: its state, asked again when the last answer is older than 15 s (`?fresh=1`
 * asks now), and any fix in progress. POST `{action}`: `test` runs Test
 * connection; `wake` starts the machine; `approve` and `connect` start the fix
 * the captain finishes on Fleetyard, and say which page to open there.
 */
async function mateFor(id: string) {
	const runtime = await getRuntime();
	if (!runtime.configured) error(503, runtime.error);
	const mate = runtime.collector.getFleet().secondMates.find((m) => m.id === id);
	if (!mate) error(404, `There is no second mate called ${id}.`);
	if (!mate.link) error(409, `${id} is not on a Fleetyard machine.`);
	return { runtime, mate };
}

const NO_STORE = { headers: { 'cache-control': 'no-store' } };

export const GET: RequestHandler = async ({ params, url }) => {
	const { runtime, mate } = await mateFor(params.id);
	await runtime.mateLinks.status(mate, url.searchParams.get('fresh') ? 0 : undefined);
	return json(runtime.mateLinks.view(mate.id), NO_STORE);
};

export const POST: RequestHandler = async ({ params, request }) => {
	const { runtime, mate } = await mateFor(params.id);
	const body = (await request.json().catch(() => null)) as { action?: unknown } | null;
	const links = runtime.mateLinks;
	switch (body?.action) {
		case 'test':
			return json(await links.test(mate), NO_STORE);
		case 'wake':
			await links.wake(mate);
			return json(links.view(mate.id), NO_STORE);
		case 'approve':
		case 'connect':
			await links.start(mate, body.action);
			return json(links.view(mate.id), NO_STORE);
	}
	error(400, 'Expected {action: test, wake, approve or connect}.');
};
