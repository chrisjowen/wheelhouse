export const HARNESSES = ['claude', 'codex', 'opencode', 'pi'] as const;
export type Harness = (typeof HARNESSES)[number];

export function parseHarness(value: string = 'claude'): Harness {
	const harness = HARNESSES.find((name) => name === value);
	if (!harness)
		throw new Error(`Unknown harness ${JSON.stringify(value)}. Choose ${HARNESSES.join(', ')}.`);
	return harness;
}
