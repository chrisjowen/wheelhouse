import { json } from '@sveltejs/kit';
import { NO_STORE, readJson } from '$lib/server/http';
import type { PluginChange } from '$lib/server/plugins/config';
import type { SettingSpec } from '$lib/server/plugins/manifest';
import { readAnswers } from '$lib/server/plugins/settings';
import { changePluginConfig, currentPluginPage } from '$lib/server/runtime';
import { asSentence, readSettings, refuse } from '$lib/server/upgrade/requests';
import type { RequestHandler } from './$types';

/** One plugin's page: where it is on, and its settings. */
export const GET: RequestHandler = async ({ params }) => {
	const view = await currentPluginPage(params.plugin);
	if (!view) return refuse(`Wheelhouse has no plugin called ${params.plugin}.`, 404);
	return json(view, { headers: NO_STORE });
};

/**
 * Change one thing about a plugin in the plugins file, which Wheelhouse
 * re-reads as it changes, so it applies without a restart:
 * `{ enabled }` for every project, `{ project, enabled }` for one (null in
 * either goes back to the default), or `{ settings }`, answers by key for
 * settings it declares. Answers with the page as it now stands.
 */
export const POST: RequestHandler = async ({ params, request }) => {
	const body = await readJson(request, 64 * 1024);
	if (!body.ok) return body.response;
	const b = body.body;
	const view = await currentPluginPage(params.plugin);
	if (!view) return refuse(`Wheelhouse has no plugin called ${params.plugin}.`, 404);
	let change: PluginChange;
	if ('settings' in b) {
		const answers = readSettings(b.settings);
		if (!answers.ok) return refuse(answers.error);
		const read = readAnswers(view.plugin.settings as SettingSpec[], answers.value);
		if (!read.ok) return refuse(asSentence(read.error));
		change = { settings: read.settings };
	} else {
		if (b.enabled !== true && b.enabled !== false && b.enabled !== null) {
			return refuse('Say whether it is on (true), off (false) or back to its default (null).');
		}
		if ('project' in b) {
			const project = view.projects.find((p) => p.id === b.project);
			if (!project) return refuse('Wheelhouse knows no such project.');
			change = { project: project.id, enabled: b.enabled };
		} else change = { enabled: b.enabled };
	}
	const r = await changePluginConfig(params.plugin, change);
	if (!r.ok) return refuse(r.error, 409);
	return json(r.view, { headers: NO_STORE });
};
