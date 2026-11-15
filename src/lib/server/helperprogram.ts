import { statSync } from 'node:fs';
import path from 'node:path';
import { HARNESSES, type Harness } from '../harness';
import { helperNotice, helperPlan, type HelperProgram, type HelperSetting } from '../helperchoice';
import { which } from './sessions/tmux';
import { readHelperChoice, readSavedChoice } from './setup/agentchoice';

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

/** Claude Code's sign-in: `$CLAUDE_CONFIG_DIR/.credentials.json`, else `~/.claude/.credentials.json`. */
export function claudeSignInFile(env: NodeJS.ProcessEnv): string | null {
	const dir = env.CLAUDE_CONFIG_DIR || (env.HOME ? path.join(env.HOME, '.claude') : '');
	if (!dir) return null;
	return fileAt(path.join(dir, '.credentials.json'));
}

function fileAt(file: string): string | null {
	try {
		return statSync(file).isFile() ? file : null;
	} catch {
		return null;
	}
}

const harnessNamed = (value: string | undefined): Harness | null =>
	value ? (HARNESSES.find((name) => name === value) ?? null) : null;

const signedIn = (runs: HelperProgram, env: NodeJS.ProcessEnv): boolean =>
	(runs === 'grok' ? grokSignInFile(env) : claudeSignInFile(env)) !== null;

/**
 * The helper this environment would run. `helper` in harness.json names
 * Claude Code or Grok on its own, whatever WHEELHOUSE_HARNESS is. No field
 * stays on Claude Code. An older `same` still follows Firstmate's agent.
 */
export function resolveHelperProgram(
	env: NodeJS.ProcessEnv,
	find: (name: string) => string | null = (name) => which(name, env.PATH)
): HelperSetting {
	const dir = helperConfigDir(env);
	if (!dir) {
		const plan = helperPlan(null, 'claude');
		return {
			...plan,
			notice: helperNotice(plan.runs, Boolean(find(plan.runs)), signedIn(plan.runs, env))
		};
	}
	const saved = readSavedChoice(dir);
	const harness = harnessNamed(env.WHEELHOUSE_HARNESS) ?? saved?.harness ?? 'claude';
	const plan = helperPlan(readHelperChoice(dir), harness);
	return {
		...plan,
		notice: helperNotice(plan.runs, Boolean(find(plan.runs)), signedIn(plan.runs, env))
	};
}
