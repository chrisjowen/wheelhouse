import { error, redirect } from '@sveltejs/kit';
import { FLEET_SHELF, recordHref } from '$lib/documents';
import { getRuntime } from '$lib/server/runtime';
import type { PageServerLoad } from './$types';

/** One task record at its permanent address: the report, the files it links, its prototypes. */
export const load: PageServerLoad = async ({ params }) => {
	const runtime = await getRuntime();
	if (!runtime.configured) error(503, runtime.error);
	const view = await runtime.documents.record(`${params.project}/${params.task}`);
	if (!view) {
		// The task id is the identity: a link naming another project still finds its record.
		const moved = await runtime.documents.find(params.task);
		if (moved) redirect(308, recordHref(moved.key));
		error(404, 'There is no such record.');
	}
	const index = await runtime.documents.index();
	const shelves = [
		...new Set([
			view.record.project,
			...index.records.map((r) => r.project),
			...index.library.map((d) => d.shelf),
			FLEET_SHELF
		])
	].sort();
	return {
		view,
		shelves,
		folders: await runtime.documents.folders(),
		libraryProblem: index.libraryProblem
	};
};
