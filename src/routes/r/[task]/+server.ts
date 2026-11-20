import { error, redirect } from '@sveltejs/kit';
import { recordHref } from '$lib/documents';
import { getRuntime } from '$lib/server/runtime';
import type { RequestHandler } from './$types';

/** The short link to a task's record (`/r/<task>`, `/r/<task>@<mate>`), for chat and status lines. */
export const GET: RequestHandler = async ({ params }) => {
	const runtime = await getRuntime();
	if (!runtime.configured) error(503, runtime.error);
	const r = await runtime.documents.find(params.task);
	if (!r) error(404, 'That task has no record.');
	redirect(307, recordHref(r.key));
};
