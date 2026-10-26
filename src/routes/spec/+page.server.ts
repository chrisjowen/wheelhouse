import { specStore } from '$lib/server/specs/access';
import type { PageServerLoad } from './$types';

// The drafts list, and the draft `?id=` names (else the most recently edited one).
export const load: PageServerLoad = async ({ url }) => {
	const s = await specStore();
	if (!s.ok) return { problem: s.reason, specs: [], draft: null, imageDir: null };
	const specs = await s.store.list();
	const id = url.searchParams.get('id') ?? specs[0]?.id ?? null;
	const draft = id ? await s.store.get(id) : null;
	return {
		problem: null,
		specs,
		draft,
		imageDir: draft ? s.store.imageDir(draft.id) : null
	};
};
