/**
 * What harness.json may say the helper is. `claude` and `grok` name that
 * program on its own. No field, or any other value, stays on Claude Code.
 */
export const HELPER_CHOICES = ['claude', 'grok'] as const;
export type HelperChoice = (typeof HELPER_CHOICES)[number];

/** A program that can run the helper. Codex, Pi and OpenCode have none. */
export const HELPER_PROGRAMS = ['claude', 'grok'] as const;
export type HelperProgram = (typeof HELPER_PROGRAMS)[number];

/** The saved choice and what it runs. */
export interface HelperSetting {
	/**
	 * `claude` or `grok` is that program, whatever agent Firstmate runs in.
	 * null has not chosen and still runs Claude Code.
	 */
	choice: HelperChoice | null;
	runs: HelperProgram;
	/**
	 * Why this helper cannot answer yet. Null when it is installed, or when
	 * nobody has looked.
	 */
	notice: string | null;
}

export const isHelperChoice = (v: unknown): v is HelperChoice => v === 'claude' || v === 'grok';

const PROGRAM_NAMES: Record<HelperProgram, string> = {
	claude: 'Claude Code',
	grok: 'Grok'
};

/** What the setup screen says when the helper's program is not installed. */
export function helperNotice(runs: HelperProgram, installed: boolean): string | null {
	if (!installed) return `${PROGRAM_NAMES[runs]} is not installed, so the helper cannot answer.`;
	return null;
}

/**
 * What a saved choice runs. `claude`, `grok` and no choice ignore Firstmate's
 * agent. Anything else is treated as no choice and runs Claude Code.
 */
export function helperPlan(choice: HelperChoice | null): HelperSetting {
	const ready = { notice: null };
	if (choice === 'grok') return { ...ready, choice, runs: 'grok' };
	return { ...ready, choice, runs: 'claude' };
}
