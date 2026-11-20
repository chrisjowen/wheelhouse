export const SECOND_MATE_RUNTIMES = [
	{
		id: 'claude-sonnet',
		label: 'Claude Code · Sonnet',
		runtime: {
			harness: 'claude',
			agent: 'claude',
			model: 'sonnet',
			effort: 'medium',
			provider: 'anthropic'
		}
	},
	{
		id: 'codex-gpt',
		label: 'Codex · GPT-5.1',
		runtime: {
			harness: 'codex',
			agent: 'codex',
			model: 'gpt-5.1',
			effort: 'medium',
			provider: 'openai'
		}
	},
	{
		id: 'pi-default',
		label: 'Pi · Default',
		runtime: {
			harness: 'pi',
			agent: 'pi',
			model: 'default',
			effort: 'medium',
			provider: 'openai'
		}
	}
] as const;

export type SecondMateRuntimeChoice = (typeof SECOND_MATE_RUNTIMES)[number];
export type SecondMateRuntimeId = SecondMateRuntimeChoice['id'];
export type SecondMateRuntime = SecondMateRuntimeChoice['runtime'];

/** Worker runtimes the current Fleetyard hosted image ships, used when Gateway machine-info reports none. */
export const FLEETYARD_IMAGE_RUNTIME_IDS: SecondMateRuntimeId[] = [
	'claude-sonnet',
	'codex-gpt',
	'pi-default'
];

export function isSecondMateRuntime(value: unknown): value is SecondMateRuntime {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	return SECOND_MATE_RUNTIMES.some(
		({ runtime }) =>
			Object.keys(runtime).every(
				(key) => (value as Record<string, unknown>)[key] === runtime[key as keyof typeof runtime]
			) && Object.keys(value).length === Object.keys(runtime).length
	);
}
