import { error } from '@sveltejs/kit';
import { getRuntime } from '$lib/server/runtime';
import type { PageServerLoad } from './$types';

/** One library document with its history, where it came from, and the library's own folder. */
export const load: PageServerLoad = async ({ params }) => {
	const runtime = await getRuntime();
	if (!runtime.configured) error(503, runtime.error);
	const d = await runtime.documents.libraryDoc(`${params.shelf}/${params.folder}/${params.slug}`);
	if (!d) error(404, 'There is no such library document.');
	return { lib: d };
};
