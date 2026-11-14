import path from 'node:path';
import { HARNESSES, type Harness } from '../harness';
import { helperPlan, type HelperSetting } from '../helperchoice';
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

const harnessNamed = (value: string | undefined): Harness | null =>
	value ? (HARNESSES.find((name) => name === value) ?? null) : null;

/** The helper this environment would run, from harness.json and WHEELHOUSE_HARNESS. */
export function resolveHelperProgram(env: NodeJS.ProcessEnv): HelperSetting {
	const dir = helperConfigDir(env);
	if (!dir) return helperPlan(null, 'claude');
	const saved = readSavedChoice(dir);
	const harness = harnessNamed(env.WHEELHOUSE_HARNESS) ?? saved?.harness ?? 'claude';
	return helperPlan(readHelperChoice(dir), harness);
}
