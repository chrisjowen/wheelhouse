import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Tree } from './files';

/**
 * What Wheelhouse installs for Firstmate and its crew: the agent skills bundled
 * in the package's `skills/` folder. Each says which of Firstmate's own
 * contracts its text relies on, so a Firstmate update that drops one shows as
 * drift (see sync.ts) instead of the skill quietly going wrong.
 */

/** The line in the bundled SKILL.md that the review surface's section replaces. */
export const REVIEW_SURFACE_MARKER = '<!-- wheelhouse:review-surface -->';

/** The plugin that is the review surface now (lib/plugins/types.ts ROLES), or null for the built-in. */
export interface ReviewSurface {
	id: string;
	name: string;
	/** An installed plugin's repository, `org/repo`, where its own instructions are. */
	repository?: string | null;
}

/** Everything a bundled file's text depends on besides the package itself. */
export interface RenderInputs {
	reviewSurface: ReviewSurface | null;
}

/** Text in a file of Firstmate's checkout that a bundled skill tells the agent to rely on. */
export interface Assumption {
	/** Relative to Firstmate's checkout. */
	file: string;
	marker: string;
}

export interface SkillBundle {
	name: string;
	files: string[];
	assumptions: Assumption[];
}

export const SKILLS: readonly SkillBundle[] = [
	{
		name: 'manage-wheelhouse',
		files: ['SKILL.md', 'references/operations.md'],
		assumptions: [
			{ file: 'bin/fm-inbox.sh', marker: 'fm-inbox.sh reply' },
			{ file: 'bin/fm-inbox.sh', marker: 'fm-inbox.sh receipts' }
		]
	}
];

/** A plugin's name as the skill may quote it: one short line of plain characters. */
const plain = (s: string) =>
	s
		.replace(/[^\p{L}\p{N} ._()-]+/gu, ' ')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, 60) || 'the plugin';

/**
 * What the skill tells Firstmate and its crew about the review surface: the
 * built-in (Lavish boards, and live previews with Wheelhouse's preview helper),
 * or the plugin the captain chose, used instead of Lavish for anything shown
 * to the captain. Rewritten, and the skill reinstalled, whenever it changes.
 */
export function reviewSurfaceSection(surface: ReviewSurface | null): string {
	if (!surface) {
		return [
			'Active review surface: **built-in**. Firstmate’s Lavish boards and Wheelhouse’s live preview, with its preview helper, are how the captain reviews work.',
			'Show the captain an HTML artifact as Firstmate’s own Lavish rule says, and a running app by reporting `preview <url>` (see Preview cards below).',
			'Wheelhouse rewrites this section when the captain chooses a review-surface plugin in Settings → Plugins (`GET /api/plugins` lists `roles`).'
		].join(' ');
	}
	const name = plain(surface.name);
	const where = surface.repository
		? `its README in https://github.com/${surface.repository}`
		: '`wheelhouse plugin list` and `GET /api/plugins`';
	return [
		`Active review surface: **${name}** (the \`${surface.id}\` plugin), chosen by the captain in Wheelhouse Settings → Plugins. While it is on it replaces Lavish and Wheelhouse’s preview helper.`,
		'',
		`- Use ${name} instead of Lavish for anything you or a worker would show the captain: an HTML artifact, a board, a design, a running app. This overrides the Lavish line in scout and worker briefs: open no Lavish board for the captain while this section names a plugin, and when you write a brief, tell the worker to use ${name} instead of Lavish.`,
		`- A running app still reports \`preview <url>\` (see Preview cards below); Wheelhouse shows ${name}’s button as the primary action on that preview, with no preview helper or board link.`,
		`- How to use ${name} is the plugin’s own; see ${where}. When it cannot show something, tell the captain rather than quietly falling back to Lavish.`,
		`- Wheelhouse rewrites this section whenever the role changes: the captain chooses another plugin or the built-in, or turns ${name} off or removes it.`
	].join('\n');
}

/** A skill's files as installed: its bundled text, with its review surface section in place. */
export async function renderSkill(
	skillsRoot: string,
	skill: SkillBundle,
	inputs: RenderInputs
): Promise<Tree> {
	const tree: Tree = {};
	for (const file of skill.files) {
		const text = await readFile(path.join(skillsRoot, skill.name, file), 'utf8');
		tree[file] =
			file === 'SKILL.md'
				? text.replace(REVIEW_SURFACE_MARKER, () => reviewSurfaceSection(inputs.reviewSurface))
				: text;
	}
	return tree;
}
