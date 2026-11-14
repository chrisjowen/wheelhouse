import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
	completeChoice,
	isAgentAuth,
	isAgentProvider,
	isSetupAgent,
	type AgentChoice
} from '../../agent';

/**
 * Setup answers given before Wheelhouse first runs: a machine the cloud
 * product made writes them at creation, so its setup wizard starts with the
 * agent and the way to pay for it already chosen and opens at the sign-in.
 * Without the file (every install on the captain's own computer), the wizard
 * is the normal one: nothing here applies, and no cloud wording shows.
 *
 * The file is `setup-answers.json` in Wheelhouse's config directory
 * ($WHEELHOUSE_CONFIG_DIR, else $XDG_CONFIG_HOME/wheelhouse, else
 * ~/.config/wheelhouse):
 *
 *   {
 *     "schema": "wheelhouse-setup-answers.v1",
 *     "agent": "claude" | "codex" | "pi" | "grok",
 *     "auth": "subscription" | "apikey" | "ours",
 *     "provider": "claude" | "chatgpt" | "anthropic" | "openai" | "grok"   (optional)
 *     "fleetyardUrl": "https://…"                                            (optional)
 *   }
 *
 * `provider` says whose subscription or key when an agent takes more than one
 * (Pi); without it the first offered is used. `fleetyardUrl` is where the
 * cloud product's own site is, for the header's way back to it (see
 * cloud/fleetyard.ts); one that is not an http(s) address is ignored. Other
 * fields (the machine's size,
 * say) are the cloud's and are ignored. The file never holds a key or token:
 * API keys are typed into the wizard, which keeps them in the vault.
 *
 * Synchronous, and free of SvelteKit imports, so the CLI bundles it.
 */

export const ANSWERS_FILE = 'setup-answers.json';
export const ANSWERS_SCHEMA = 'wheelhouse-setup-answers.v1';

export const answersFile = (configDir: string) => path.join(configDir, ANSWERS_FILE);

export type AnswersRead =
	| { state: 'none' }
	| { state: 'ok'; choice: AgentChoice; fleetyard: string | null }
	| { state: 'invalid'; problem: string };

/** The answers in `configDir`: none, the choice they make, or why they cannot be used. */
export function readAnswers(configDir: string): AnswersRead {
	const file = answersFile(configDir);
	let text: string;
	try {
		text = readFileSync(file, 'utf8');
	} catch (e) {
		if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { state: 'none' };
		return { state: 'invalid', problem: `Cannot read ${file}: ${(e as Error).message}` };
	}
	const bad = (why: string) => ({ state: 'invalid' as const, problem: `${file}: ${why}` });
	let raw: unknown;
	try {
		raw = JSON.parse(text);
	} catch {
		return bad('not JSON.');
	}
	if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return bad('not an object.');
	const { schema, agent, auth, provider, fleetyardUrl } = raw as Record<string, unknown>;
	if (schema !== ANSWERS_SCHEMA) return bad(`schema must be "${ANSWERS_SCHEMA}".`);
	if (!isSetupAgent(agent)) return bad('agent must be claude, codex, pi or grok.');
	if (!isAgentAuth(auth)) return bad('auth must be subscription, apikey or ours.');
	if (provider !== undefined && provider !== null && !isAgentProvider(provider))
		return bad('provider must be claude, chatgpt, anthropic, openai or grok.');
	return {
		state: 'ok',
		choice: completeChoice(agent, auth, provider, true),
		fleetyard: siteUrl(fleetyardUrl)
	};
}

/** An http(s) address without credentials, as given; null for anything else. */
function siteUrl(v: unknown): string | null {
	if (typeof v !== 'string' || v.length > 2048) return null;
	const u = URL.parse(v.trim());
	if (!u || (u.protocol !== 'https:' && u.protocol !== 'http:') || u.username || u.password)
		return null;
	return u.href;
}
