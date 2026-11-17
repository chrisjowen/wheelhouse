import { decisionsPage, decisionsQuery } from '$lib/insights';
import { currentDecisions } from '$lib/server/runtime';
import type { PageServerLoad } from './$types';

/** One page of the decisions, filtered on the server: never every decision in the ledger. */
export const load: PageServerLoad = async ({ url }) => ({
	view: decisionsPage(await currentDecisions(), decisionsQuery(url.searchParams))
});
