import { json } from '@sveltejs/kit';
import { NO_STORE, readJson } from '$lib/server/http';
import { quotaKeys } from '$lib/server/insights/quota-keys';
import type { RequestHandler } from './$types';

/** Settings → Headroom: which vault secret holds each provider's key for quota-axi (names only). */
export const GET: RequestHandler = async () =>
	json(await quotaKeys().view(), { headers: NO_STORE });

export const POST: RequestHandler = async ({ request }) => {
	const read = await readJson(request, 4096);
	if (!read.ok) return read.response;
	return json(await quotaKeys().save(read.body), { headers: NO_STORE });
};
