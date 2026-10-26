import { specInterviewer, specStore } from '$lib/server/specs/access';
import type { PageServerLoad } from './$types';

// The drafts list, the draft `?id=` names (else the most recently edited one),
// and the interviewer: its model, and whether it is working on that draft.
export const load: PageServerLoad = async ({ url }) => {
	const s = await specStore();
	if (!s.ok) {
		return { problem: s.reason, specs: [], draft: null, imageDir: null, interviewer: null };
	}
	const specs = await s.store.list();
	const id = url.searchParams.get('id') ?? specs[0]?.id ?? null;
	const draft = id ? await s.store.get(id) : null;
	const interviewer = specInterviewer(s.store);
	return {
		problem: null,
		specs,
		draft,
		imageDir: draft ? s.store.imageDir(draft.id) : null,
		interviewer: {
			model: interviewer.settings.model,
			effort: interviewer.settings.effort,
			busy: draft ? interviewer.isBusy(draft.id) : false
		}
	};
};
