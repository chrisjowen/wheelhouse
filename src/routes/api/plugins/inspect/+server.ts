import { json } from '@sveltejs/kit';
import { NO_STORE, readJson } from '$lib/server/http';
import { asSentence, readRef, readRepo, refuse } from '$lib/server/upgrade/requests';
import { updateService } from '$lib/server/upgrade/service';
import type { RequestHandler } from './$types';

/**
 * Look a plugin up before installing or updating it: fetch it, check its
 * manifest and answer with what it is, where from, the exact commit and the
 * settings it asks for. Changes nothing. `{ repo, ref? }` for a new plugin,
 * `{ id, ref? }` for an installed one (a ref moves it, as to a newer tag).
 */
export const POST: RequestHandler = async ({ request }) => {
	const body = await readJson(request, 4096);
	if (!body.ok) return body.response;
	const ref = readRef(body.body.ref);
	if (!ref.ok) return refuse(ref.error);
	const s = updateService();
	let r;
	if (typeof body.body.id === 'string') {
		r = await s.inspectUpdate(body.body.id, ref.value);
	} else {
		const repo = readRepo(body.body.repo);
		if (!repo.ok) return refuse(repo.error);
		r = await s.inspectInstall(repo.value, ref.value);
	}
	if (!r.ok) return refuse(asSentence(r.error), 422);
	return json(r.preview, { headers: NO_STORE });
};
