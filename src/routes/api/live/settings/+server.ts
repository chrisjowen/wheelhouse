import { json } from '@sveltejs/kit';
import { NO_STORE, readJson } from '$lib/server/http';
import { defaultConfigDir } from '$lib/server/plugins/config';
import { getRuntime } from '$lib/server/runtime';
import { crewToolsView, saveCrewSettings } from '$lib/server/live/tools';
import { which } from '$lib/server/sessions/tmux';
import type { RequestHandler } from './$types';

/** Settings → Discussion: the tools, MCP servers and skills the discussion crew launches with. */
async function view() {
	const runtime = await getRuntime();
	const home = runtime.configured ? runtime.install.homeDir : process.cwd();
	const claude = process.env.WHEELHOUSE_LIVE_CLAUDE || which('claude', process.env.PATH);
	return crewToolsView({ configDir: defaultConfigDir(process.env), home }, claude);
}

export const GET: RequestHandler = async () => json(await view(), { headers: NO_STORE });

export const POST: RequestHandler = async ({ request }) => {
	const read = await readJson(request, 16 * 1024);
	if (!read.ok) return read.response;
	await saveCrewSettings(defaultConfigDir(process.env), read.body);
	return json(await view(), { headers: NO_STORE });
};
