import { HANDLED_DAYS } from '$lib/handled';
import { currentDecisions } from '$lib/server/runtime';
import type { PageServerLoad } from './$types';

// The calls Firstmate made itself, for Handled by Firstmate (the open questions come with the layout):
// only the last HANDLED_DAYS, which is all it lists, not every decision in the ledger.
export const load: PageServerLoad = async () => {
	const view = await currentDecisions();
	const since = Date.now() - HANDLED_DAYS * 86_400_000;
	return {
		handled: { ...view, decisions: view.decisions.filter((d) => Date.parse(d.decidedAt) >= since) }
	};
};
