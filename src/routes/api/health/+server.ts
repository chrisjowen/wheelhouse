import { json } from '@sveltejs/kit';
import { currentHealth } from '$lib/server/runtime';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () =>
	json(await currentHealth(), { headers: { 'cache-control': 'no-store' } });
