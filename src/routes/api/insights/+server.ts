import { json } from '@sveltejs/kit';
import { currentRailInsights } from '$lib/server/runtime';
import type { RequestHandler } from './$types';

/** The rail's insights: recent decisions made for the captain, today's time, the allowance. */
export const GET: RequestHandler = async () =>
	json(await currentRailInsights(), { headers: { 'cache-control': 'no-store' } });
