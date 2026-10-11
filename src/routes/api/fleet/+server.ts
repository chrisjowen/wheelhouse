import { json } from '@sveltejs/kit';
import { currentFleet } from '$lib/server/runtime';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () =>
	json(await currentFleet(), { headers: { 'cache-control': 'no-store' } });
