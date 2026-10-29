import { json } from '@sveltejs/kit';
import { NO_STORE, readJson } from '$lib/server/http';
import {
	asSentence,
	readCommit,
	readRef,
	readRepo,
	readSettings,
	refuse
} from '$lib/server/upgrade/requests';
import { updateService } from '$lib/server/upgrade/service';
import type { RequestHandler } from './$types';

/**
 * Install a plugin a look-up showed: `{ repo, ref?, commit, settings }`. It is
 * fetched again and kept only at that same commit, its settings are written to
 * the plugins file, and Wheelhouse restarts to load it.
 */
export const POST: RequestHandler = async ({ request }) => {
	const body = await readJson(request, 64 * 1024);
	if (!body.ok) return body.response;
	const repo = readRepo(body.body.repo);
	if (!repo.ok) return refuse(repo.error);
	const ref = readRef(body.body.ref);
	if (!ref.ok) return refuse(ref.error);
	const commit = readCommit(body.body.commit);
	if (!commit.ok) return refuse(commit.error);
	const settings = readSettings(body.body.settings);
	if (!settings.ok) return refuse(settings.error);
	const r = await updateService().installPlugin({
		repo: repo.value,
		ref: ref.value,
		commit: commit.value,
		settings: settings.value
	});
	if (!r.ok) return refuse(asSentence(r.error), 409);
	return json(r, { headers: NO_STORE });
};
