import { readDoc } from '$lib/server/files/docfile';
import { currentFileRoots } from '$lib/server/runtime';
import type { PageServerLoad } from './$types';

/** A Markdown file Firstmate or a worker named, from inside the folders Wheelhouse may read. */
export const load: PageServerLoad = async ({ url }) => {
	const requested = url.searchParams.get('path') ?? '';
	const roots = await currentFileRoots();
	if (!roots) return { requested, doc: null, problem: 'Firstmate is not set up.' };
	const r = await readDoc(requested, roots);
	return r.ok
		? { requested, doc: r.doc, problem: null }
		: { requested, doc: null, problem: r.message };
};
