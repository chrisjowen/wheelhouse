import { error } from '@sveltejs/kit';
import path from 'node:path';
import { getRuntime } from '$lib/server/runtime';
import type { PageServerLoad } from './$types';

/** A live prototype a task left: where it runs when it does, else its screenshots and files. */
export const load: PageServerLoad = async ({ params }) => {
	const runtime = await getRuntime();
	if (!runtime.configured) error(503, runtime.error);
	const found = await runtime.documents.prototype(
		`${params.project}/${params.task}/${params.name}`
	);
	if (!found) error(404, 'There is no such prototype.');
	const { source } = found.prototype;
	return {
		...found,
		sourceDir: path.isAbsolute(source) ? source : path.join(runtime.install.homeDir, source)
	};
};
