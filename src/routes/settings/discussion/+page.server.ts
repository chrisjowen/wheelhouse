import { defaultConfigDir } from '$lib/server/plugins/config';
import { getRuntime } from '$lib/server/runtime';
import { crewToolsView } from '$lib/server/live/tools';
import { which } from '$lib/server/sessions/tmux';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const runtime = await getRuntime();
	const home = runtime.configured ? runtime.install.homeDir : process.cwd();
	const claude = process.env.WHEELHOUSE_LIVE_CLAUDE || which('claude', process.env.PATH);
	return { tools: await crewToolsView({ configDir: defaultConfigDir(process.env), home }, claude) };
};
