import { HARNESS_NAMES, type Harness } from './harness';

/** Which program answers Wheelhouse's own helper: the preview helper and feedback summaries. */
export const HELPER_CHOICES = ['same', 'claude'] as const;
export type HelperChoice = (typeof HELPER_CHOICES)[number];

/** A program that can run the helper. Codex, Pi and OpenCode have none. */
export type HelperProgram = 'claude' | 'grok';

/** The saved choice, what it runs, and a sentence when that is a fallback. */
export interface HelperSetting {
	/** `same` follows Firstmate's agent; `claude` is always Claude Code; null has not chosen. */
	choice: HelperChoice | null;
	runs: HelperProgram;
	/** Set when `same` follows an agent with no helper, so the run is Claude Code. */
	fallback: string | null;
}

export const isHelperChoice = (v: unknown): v is HelperChoice => v === 'same' || v === 'claude';

/**
 * What a saved choice runs. No choice, or `claude`, is Claude Code. `same`
 * is Grok only when Firstmate's agent is Grok; every other agent uses Claude
 * Code, and one with no helper of its own says so.
 */
export function helperPlan(choice: HelperChoice | null, harness: Harness): HelperSetting {
	if (choice !== 'same') return { choice, runs: 'claude', fallback: null };
	if (harness === 'grok') return { choice, runs: 'grok', fallback: null };
	if (harness === 'claude') return { choice, runs: 'claude', fallback: null };
	return {
		choice,
		runs: 'claude',
		fallback: `${HARNESS_NAMES[harness]} has no helper of its own, so this uses Claude Code.`
	};
}
