import { HARNESS_NAMES, type Harness } from './harness';

/**
 * What harness.json may say the helper is. `claude` and `grok` name that
 * program on its own. `same` is an older save that follows Firstmate's agent.
 */
export const HELPER_CHOICES = ['same', 'claude', 'grok'] as const;
export type HelperChoice = (typeof HELPER_CHOICES)[number];

/** A program that can run the helper. Codex, Pi and OpenCode have none. */
export const HELPER_PROGRAMS = ['claude', 'grok'] as const;
export type HelperProgram = (typeof HELPER_PROGRAMS)[number];

/** The saved choice, what it runs, and a sentence when that is a fallback. */
export interface HelperSetting {
	/**
	 * `claude` or `grok` is that program, whatever agent Firstmate runs in.
	 * `same` follows Firstmate's agent. null has not chosen and still runs
	 * Claude Code.
	 */
	choice: HelperChoice | null;
	runs: HelperProgram;
	/** Set when an older `same` save follows an agent with no helper. */
	fallback: string | null;
	/**
	 * Why this helper cannot answer yet. Null when it is installed and signed
	 * in, or when nobody has looked.
	 */
	notice: string | null;
}

export const isHelperChoice = (v: unknown): v is HelperChoice =>
	v === 'same' || v === 'claude' || v === 'grok';

const PROGRAM_NAMES: Record<HelperProgram, string> = {
	claude: 'Claude Code',
	grok: 'Grok'
};

/** What the setup screen says when the helper's program is not ready to answer. */
export function helperNotice(
	runs: HelperProgram,
	installed: boolean,
	signedIn: boolean
): string | null {
	const name = PROGRAM_NAMES[runs];
	if (!installed) return `${name} is not installed, so the helper cannot answer.`;
	if (!signedIn) return `${name} is not signed in, so the helper cannot answer.`;
	return null;
}

/**
 * What a saved choice runs. `claude`, `grok` and no choice ignore Firstmate's
 * agent. `same` is Grok only when that agent is Grok; every other agent uses
 * Claude Code, and one with no helper of its own says so.
 */
export function helperPlan(choice: HelperChoice | null, harness: Harness): HelperSetting {
	const ready = { notice: null };
	if (choice === 'grok') return { ...ready, choice, runs: 'grok', fallback: null };
	if (choice !== 'same') return { ...ready, choice, runs: 'claude', fallback: null };
	if (harness === 'grok') return { ...ready, choice, runs: 'grok', fallback: null };
	if (harness === 'claude') return { ...ready, choice, runs: 'claude', fallback: null };
	return {
		...ready,
		choice,
		runs: 'claude',
		fallback: `${HARNESS_NAMES[harness]} has no helper of its own, so this uses Claude Code.`
	};
}
