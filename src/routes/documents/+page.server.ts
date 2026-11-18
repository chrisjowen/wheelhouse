import { getRuntime } from '$lib/server/runtime';
import type { PageServerLoad } from './$types';

/** Every task's record and prototype, and the library, by title (see server/documents). */
export const load: PageServerLoad = async () => {
	const runtime = await getRuntime();
	if (!runtime.configured) return { index: null, problem: runtime.error };
	return { index: await runtime.documents.index(), problem: null };
};
