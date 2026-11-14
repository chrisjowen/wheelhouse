import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
	completeChoice,
	defaultChoice,
	isAgentAuth,
	isAgentProvider,
	setupAgentOf,
	type AgentChoice
} from '../../agent';
import { HARNESSES, type Harness } from '../../harness';
import { readAnswers, type AnswersRead } from './answers';

/**
 * Which agent Firstmate runs in, and how it is paid for, as the setup wizard
 * keeps it: `harness.json` in Wheelhouse's config directory, the file
 * `wheelhouse open` already reads for its saved tool choice (cli/harness.ts),
 * with the wizard's way to pay beside it:
 *
 *   { "harness": "pi", "auth": "apikey", "provider": "openai" }
 *
 * The harness running now is WHEELHOUSE_HARNESS, which `wheelhouse open`
 * resolved (flag, variable, this file, the setup answers, its picker, else
 * claude). When the flag or the variable chose it (WHEELHOUSE_HARNESS_FIXED=1),
 * the wizard shows it and does not change it.
 *
 * Synchronous, and free of SvelteKit imports, so the CLI bundles it.
 */

export const HARNESS_FILE = 'harness.json';

export const harnessFile = (configDir: string) => path.join(configDir, HARNESS_FILE);

export interface SavedChoice {
	harness: Harness;
	auth: AgentChoice['auth'] | null;
	provider: AgentChoice['provider'];
}

/** The saved choice, or null when there is none or the file is not one. */
export function readSavedChoice(configDir: string): SavedChoice | null {
	let raw: unknown;
	try {
		raw = JSON.parse(readFileSync(harnessFile(configDir), 'utf8'));
	} catch {
		return null;
	}
	if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
	const { harness, auth, provider } = raw as Record<string, unknown>;
	const h = HARNESSES.find((n) => n === harness);
	if (!h) return null;
	return {
		harness: h,
		auth: isAgentAuth(auth) ? auth : null,
		provider: isAgentProvider(provider) ? provider : null
	};
}

/** Keep `c` as the saved choice, through a temporary file so a reader never sees half of it. */
export function writeSavedChoice(configDir: string, c: AgentChoice): void {
	mkdirSync(configDir, { recursive: true, mode: 0o700 });
	const file = harnessFile(configDir);
	const tmp = `${file}.${process.pid}.tmp`;
	try {
		writeFileSync(
			tmp,
			`${JSON.stringify({ harness: c.agent, auth: c.auth, provider: c.provider })}\n`,
			{ mode: 0o600 }
		);
		renameSync(tmp, file);
	} finally {
		rmSync(tmp, { force: true });
	}
}

/** Why the wizard may not change the agent, or null when it may. */
export const fixedHarness = (env: NodeJS.ProcessEnv): string | null =>
	env.WHEELHOUSE_HARNESS_FIXED === '1'
		? 'This Wheelhouse was started with --harness or WHEELHOUSE_HARNESS, which wins over the choice here. Start it without them to choose here.'
		: null;

/**
 * The agent and way to pay the wizard works with: the running harness, paid
 * for as the saved choice says, else as the setup answers say, else with its
 * subscription. null when the harness is one the wizard does not set up.
 */
export function currentChoice(
	harness: Harness,
	configDir: string,
	answers: AnswersRead = readAnswers(configDir)
): AgentChoice | null {
	const agent = setupAgentOf(harness);
	if (!agent) return null;
	return madeChoice(harness, configDir, answers) ?? defaultChoice(agent);
}

/**
 * The way to pay for `harness` that was chosen (in the wizard, or by the setup
 * answers), or null when nobody chose one: the agent then keeps its own
 * defaults.
 */
export function madeChoice(
	harness: Harness,
	configDir: string,
	answers: AnswersRead = readAnswers(configDir)
): AgentChoice | null {
	const agent = setupAgentOf(harness);
	if (!agent) return null;
	const saved = readSavedChoice(configDir);
	if (saved?.harness === agent && saved.auth)
		return completeChoice(agent, saved.auth, saved.provider, answers.state === 'ok');
	if (answers.state === 'ok' && answers.choice.agent === agent) return answers.choice;
	return null;
}
