import { statSync } from 'node:fs';
import path from 'node:path';
import { helperNotice, helperPlan, type HelperSetting } from '../helperchoice';
import { which } from './sessions/tmux';
import { readHelperChoice } from './setup/agentchoice';

/**
 * Where the helper reads harness.json. `wheelhouse open` sets
 * WHEELHOUSE_CONFIG_DIR before the server starts. With none of these set,
 * the helper does not look in a home directory: it stays on Claude Code.
 */
export function helperConfigDir(env: NodeJS.ProcessEnv): string | null {
	if (env.WHEELHOUSE_CONFIG_DIR) return env.WHEELHOUSE_CONFIG_DIR;
	if (env.XDG_CONFIG_HOME) return path.join(env.XDG_CONFIG_HOME, 'wheelhouse');
	if (env.HOME) return path.join(env.HOME, '.config', 'wheelhouse');
	return null;
}

/**
 * Grok's sign-in, the file a helper run copies into its throwaway home.
 * GROK_HOME, else ~/.grok. Never a guessed directory.
 */
export function grokSignInFile(env: NodeJS.ProcessEnv): string | null {
	const home = env.GROK_HOME || (env.HOME ? path.join(env.HOME, '.grok') : '');
	if (!home) return null;
	return fileAt(path.join(home, 'auth.json'));
}

function fileAt(file: string): string | null {
	try {
		return statSync(file).isFile() ? file : null;
	} catch {
		return null;
	}
}

/**
 * The helper this environment would run for preview help and feedback
 * summaries. `helper` in harness.json names Claude Code or Grok on its own,
 * whatever WHEELHOUSE_HARNESS is. No field, or any other value, stays on
 * Claude Code. Claude Code counts as installed when WHEELHOUSE_PREVIEW_CLAUDE
 * names its binary, since that is the one the helper runs.
 */
export function resolveHelperProgram(
	env: NodeJS.ProcessEnv,
	find: (name: string) => string | null = (name) => which(name, env.PATH)
): HelperSetting {
	const dir = helperConfigDir(env);
	const plan = helperPlan(dir ? readHelperChoice(dir) : null);
	return {
		...plan,
		notice: helperNotice(
			plan.runs,
			Boolean((plan.runs === 'claude' && env.WHEELHOUSE_PREVIEW_CLAUDE) || find(plan.runs))
		)
	};
}
