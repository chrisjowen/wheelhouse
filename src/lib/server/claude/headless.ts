/** Keys that make the claude CLI bill an API key instead of the claude.ai login. */
const API_KEY_VARS = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'];

/**
 * The environment a headless claude run gets: Wheelhouse's own, signed in the
 * way the captain's interactive Claude Code is. The CLI prefers an API key in
 * the environment over the claude.ai login, and a stale key set for every app
 * (launchctl, a shell profile) then fails every run, so the key is dropped
 * unless WHEELHOUSE_CLAUDE_USE_API_KEY=1 asks for key-based billing. A
 * surrounding Claude Code session's variables are dropped too, so the run
 * never attaches to it; CLAUDE_CODE_OAUTH_TOKEN stays, as it is a claude.ai
 * login (`claude setup-token`), not a session variable.
 */
export function claudeEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
	const keepKey = env.WHEELHOUSE_CLAUDE_USE_API_KEY === '1';
	const out: NodeJS.ProcessEnv = {};
	for (const [k, v] of Object.entries(env)) {
		if (k === 'CLAUDECODE' || (/^CLAUDE_CODE_/.test(k) && k !== 'CLAUDE_CODE_OAUTH_TOKEN'))
			continue;
		if (!keepKey && API_KEY_VARS.includes(k)) continue;
		out[k] = v;
	}
	return out;
}
