import { HARNESS_NAMES, type Harness } from './harness';

/**
 * The agent Firstmate runs in, and how it is paid for, as the setup wizard's
 * agent step offers it: Claude Code, Codex or Pi, each signed in with the
 * captain's own subscription or API key. Some ways are not ready yet and show
 * as "coming soon", never selectable. Paying through the cloud product itself
 * ("ours") shows only on a machine it made (see server/setup/answers.ts).
 * Pure, so the page, the server and the tests share it.
 */

/** The display name of the hosted product. It lives here and nowhere else. */
export const CLOUD_PRODUCT = 'Fleetyard';

/** The agents the wizard sets up (OpenCode is only chosen with `--harness opencode`). */
export const SETUP_AGENTS = ['claude', 'codex', 'pi'] as const;
export type SetupAgent = (typeof SETUP_AGENTS)[number];

export const isSetupAgent = (v: unknown): v is SetupAgent =>
	typeof v === 'string' && (SETUP_AGENTS as readonly string[]).includes(v);

/** Who pays: the captain's subscription, the captain's API key, or the cloud product. */
export const AGENT_AUTHS = ['subscription', 'apikey', 'ours'] as const;
export type AgentAuth = (typeof AGENT_AUTHS)[number];

export const isAgentAuth = (v: unknown): v is AgentAuth =>
	typeof v === 'string' && (AGENT_AUTHS as readonly string[]).includes(v);

/** Whose account: a subscription's (claude, chatgpt) or an API key's (anthropic, openai). */
export const AGENT_PROVIDERS = ['claude', 'chatgpt', 'anthropic', 'openai'] as const;
export type AgentProvider = (typeof AGENT_PROVIDERS)[number];

export const isAgentProvider = (v: unknown): v is AgentProvider =>
	typeof v === 'string' && (AGENT_PROVIDERS as readonly string[]).includes(v);

export interface AgentChoice {
	agent: SetupAgent;
	auth: AgentAuth;
	/** null only for `ours`. */
	provider: AgentProvider | null;
}

export interface AuthOption extends AgentChoice {
	label: string;
	detail: string;
	/** false: shown as coming soon, not selectable. */
	ready: boolean;
}

/** The environment variable name, and the vault's name, of each API key the wizard stores. */
export const API_KEY_NAMES = {
	anthropic: 'ANTHROPIC_API_KEY',
	openai: 'OPENAI_API_KEY'
} as const satisfies Partial<Record<AgentProvider, string>>;
export type KeyProvider = keyof typeof API_KEY_NAMES;

export const isKeyProvider = (p: AgentProvider | null): p is KeyProvider =>
	p === 'anthropic' || p === 'openai';

const option = (
	agent: SetupAgent,
	auth: AgentAuth,
	provider: AgentProvider | null,
	label: string,
	detail: string,
	ready = true
): AuthOption => ({ agent, auth, provider, label, detail, ready });

/** How `agent` can be paid for; `cloud` adds paying through the cloud product. */
export function authOptions(agent: SetupAgent, cloud: boolean): AuthOption[] {
	const ours = option(
		agent,
		'ours',
		null,
		`Paid by ${CLOUD_PRODUCT}`,
		`${CLOUD_PRODUCT} pays for the model; nothing to sign in to.`,
		false
	);
	const list: AuthOption[] =
		agent === 'claude'
			? [
					option(
						agent,
						'subscription',
						'claude',
						'My Claude subscription',
						'Sign in to Claude Code with your Claude Pro or Max account.'
					),
					option(
						agent,
						'apikey',
						'anthropic',
						'My Anthropic API key',
						'Claude Code billed to an Anthropic API key.',
						false
					)
				]
			: agent === 'codex'
				? [
						option(
							agent,
							'subscription',
							'chatgpt',
							'My ChatGPT subscription',
							'Sign in to Codex with your ChatGPT Plus or Pro account.'
						),
						option(
							agent,
							'apikey',
							'openai',
							'My OpenAI API key',
							'Codex billed to an OpenAI API key.'
						)
					]
				: [
						option(
							agent,
							'subscription',
							'chatgpt',
							'My ChatGPT subscription',
							'Sign in to Pi with your ChatGPT Plus or Pro account.'
						),
						option(
							agent,
							'subscription',
							'claude',
							'My Claude subscription',
							'Pi with a Claude Pro or Max account.',
							false
						),
						option(
							agent,
							'apikey',
							'openai',
							'My OpenAI API key',
							'Pi billed to an OpenAI API key.'
						),
						option(
							agent,
							'apikey',
							'anthropic',
							'My Anthropic API key',
							'Pi billed to an Anthropic API key.'
						)
					];
	return cloud ? [...list, ours] : list;
}

const same = (a: AgentChoice, b: AgentChoice) =>
	a.agent === b.agent && a.auth === b.auth && a.provider === b.provider;

/** The offered option `c` is, or null when it is not one. */
export const optionFor = (c: AgentChoice, cloud: boolean): AuthOption | null =>
	authOptions(c.agent, cloud).find((o) => same(o, c)) ?? null;

/** Whether the wizard can set `c` up now (offered, and not coming soon). */
export const isReady = (c: AgentChoice, cloud: boolean) => optionFor(c, cloud)?.ready === true;

/** The first ready way to pay for `agent`: its subscription. */
export function defaultChoice(agent: SetupAgent): AgentChoice {
	const first = authOptions(agent, false).find((o) => o.ready)!;
	return { agent, auth: first.auth, provider: first.provider };
}

/**
 * The choice for an auth and provider someone gave (the answers file, a
 * request): a missing provider is the first one offered for that auth.
 */
export function completeChoice(
	agent: SetupAgent,
	auth: AgentAuth,
	provider: AgentProvider | null | undefined,
	cloud: boolean
): AgentChoice {
	if (auth === 'ours') return { agent, auth, provider: null };
	const offered = authOptions(agent, cloud).filter((o) => o.auth === auth);
	const match = offered.find((o) => o.provider === provider) ?? offered[0];
	return match ? { agent, auth, provider: match.provider } : defaultChoice(agent);
}

/** The setup agent a harness is, or null for one the wizard does not set up (OpenCode). */
export const setupAgentOf = (h: Harness): SetupAgent | null => (isSetupAgent(h) ? h : null);

export const agentName = (a: SetupAgent) => HARNESS_NAMES[a];

/** "Codex, with my OpenAI API key"; "Pi, paid by Fleetyard". */
export function choiceWords(c: AgentChoice, cloud: boolean): string {
	const o = optionFor(c, cloud);
	if (!o) return agentName(c.agent);
	const how = o.label.charAt(0).toLowerCase() + o.label.slice(1);
	return `${agentName(c.agent)}, ${c.auth === 'ours' ? how : `with ${how}`}`;
}
