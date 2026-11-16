/**
 * Words a speech-to-text provider should expect: the fleet's own vocabulary,
 * then the projects and the tasks not yet landed, by name. Each is short
 * enough to be a key term (50 characters, five words) and the list stays
 * under the provider's limit. Pure, so it is unit-tested.
 */

const VOCABULARY = [
	'Firstmate',
	'Wheelhouse',
	'second mate',
	'Fleetyard',
	'Gateway',
	'Docket',
	'Docket Cloud',
	'Harbour',
	'Captain’s briefing',
	'pull request',
	'no-mistakes',
	'Claude Code',
	'Codex',
	'OpenCode',
	'Pi',
	'Grok',
	'Herdr',
	'Lavish',
	'ElevenLabs',
	'Hostinger',
	'Mermaid'
];

export function keyterms(
	fleet: { projects: { id: string; name: string }[]; tasks: { id: string; status: string }[] },
	max = 95
): string[] {
	const out: string[] = [];
	const seen = new Set<string>();
	const add = (term: string) => {
		const t = term.trim();
		const key = t.toLowerCase();
		if (!t || seen.has(key) || t.length > 50 || t.split(/\s+/).length > 5) return;
		seen.add(key);
		out.push(t);
	};
	for (const word of VOCABULARY) add(word);
	for (const p of fleet.projects) add(p.name || p.id);
	for (const t of fleet.tasks) if (t.status !== 'landed') add(t.id.split('@')[0]);
	return out.slice(0, max);
}
