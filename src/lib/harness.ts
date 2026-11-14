export const HARNESSES = ['claude', 'codex', 'opencode', 'pi', 'grok'] as const;
export type Harness = (typeof HARNESSES)[number];

/** How the page names each tool to the captain. */
export const HARNESS_NAMES: Record<Harness, string> = {
	claude: 'Claude Code',
	codex: 'Codex',
	opencode: 'OpenCode',
	pi: 'Pi',
	grok: 'Grok'
};

export function parseHarness(value: string = 'claude'): Harness {
	const harness = HARNESSES.find((name) => name === value);
	if (!harness)
		throw new Error(`Unknown harness ${JSON.stringify(value)}. Choose ${HARNESSES.join(', ')}.`);
	return harness;
}
