import { json } from '@sveltejs/kit';
import { currentPlugins } from '$lib/server/runtime';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () =>
	json(await currentPlugins(), { headers: { 'cache-control': 'no-store' } });
