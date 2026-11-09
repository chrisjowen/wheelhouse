import { error, json } from '@sveltejs/kit';
import { PEEK_DEFAULT_LINES } from '$lib/server/firstmate/adapter';
import { getRuntime } from '$lib/server/runtime';
import type { RequestHandler } from './$types';

/**
 * A bounded, read-only look at one second mate's own terminal (see
 * lib/server/firstmate/matepeek.ts): `?lines=<n>`, at most 100 for a remote
 * one and 200 for a local one. The page asks only when the captain opens it.
 * Nothing here can steer, message or control the second mate.
 */
export const GET: RequestHandler = async ({ params, url }) => {
	const runtime = await getRuntime();
	if (!runtime.configured) error(503, runtime.error);
	const mate = runtime.collector.getFleet().secondMates.find((m) => m.id === params.id);
	if (!mate) error(404, `There is no second mate called ${params.id}.`);
	const lines = Number(url.searchParams.get('lines') ?? PEEK_DEFAULT_LINES);
	return json(await runtime.matePeeks.look(mate, lines), {
		headers: { 'cache-control': 'no-store' }
	});
};
