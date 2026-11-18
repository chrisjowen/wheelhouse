import { json } from '@sveltejs/kit';
import { NO_STORE, readJson } from '$lib/server/http';
import { getRuntime } from '$lib/server/runtime';
import type { RequestHandler } from './$types';

const refs = (v: unknown) =>
	Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.length <= 300) : [];

/**
 * What a Live discussion's crew is told when the captain brings documents in:
 * `full` (records `<project>/<task>`, `lib:<key>`, `proto:<id>`) attached in
 * full up to a size limit, and `titles` listed by title with the file to open.
 * Only builds the words; the page sends them to the crew.
 */
export const POST: RequestHandler = async ({ request }) => {
	const runtime = await getRuntime();
	if (!runtime.configured)
		return json({ message: runtime.error }, { status: 503, headers: NO_STORE });
	const read = await readJson(request, 32 * 1024);
	if (!read.ok) return read.response;
	return json(await runtime.documents.briefing(refs(read.body.full), refs(read.body.titles)), {
		headers: NO_STORE
	});
};
