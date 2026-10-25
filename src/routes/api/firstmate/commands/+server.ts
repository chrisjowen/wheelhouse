import { json } from '@sveltejs/kit';
import { getRuntime } from '$lib/server/runtime';
import { NO_STORE } from '$lib/server/http';
import { BUILTIN_COMMANDS, slashCommands } from '$lib/server/sessions/commands';
import type { RequestHandler } from './$types';

/** The slash commands the composer offers: Firstmate's own, then Claude Code's. */
export const GET: RequestHandler = async () => {
	const runtime = await getRuntime();
	const commands = runtime.configured
		? await slashCommands(runtime.install.firstmateDir)
		: BUILTIN_COMMANDS;
	return json({ commands }, { headers: NO_STORE });
};
