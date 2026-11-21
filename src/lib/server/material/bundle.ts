import path from 'node:path';
import { readTree, type Tree } from './files';

/**
 * What Wheelhouse installs for Firstmate and its crew: the agent skills bundled
 * in the package's `skills/` folder, a block of worker rules for the Firstmate
 * home's `config/brief-include.md` (briefBlock), and the context the Firstmate
 * session Wheelhouse starts is given (sessionContext). Each skill says which of
 * Firstmate's own contracts its text relies on, so a Firstmate update that
 * drops one shows as drift (see sync.ts) instead of the skill quietly going
 * wrong. Nothing here names a host, person or account: every captain gets it.
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

/** What the session context also says: the Wheelhouse that started the session. */
export interface ContextInputs extends RenderInputs {
	version: string;
	/** Where the captain reads the chat, or null when the server does not know its own address. */
	url: string | null;
}

/** Text in a file of Firstmate's checkout that a bundled skill tells the agent to rely on. */
export interface Assumption {
	/** Relative to Firstmate's checkout. */
	file: string;
	marker: string;
}

/** A bundled skill: its folder under `skills/`, every file in it installed. */
export interface SkillBundle {
	name: string;
	assumptions: Assumption[];
}

export const SKILLS: readonly SkillBundle[] = [
	{
		name: 'manage-wheelhouse',
		assumptions: [
			{ file: 'bin/fm-inbox.sh', marker: 'fm-inbox.sh reply' },
			{ file: 'bin/fm-inbox.sh', marker: 'fm-inbox.sh receipts' },
			{ file: 'bin/fm-captain-hold.sh', marker: 'fm-captain-hold.sh' }
		]
	},
	{ name: 'wheelhouse-preview', assumptions: [] },
	{ name: 'wheelhouse-passage', assumptions: [] }
];

/** What the worker block relies on: Firstmate appending the home's brief-include file to each brief. */
export const BRIEF_ASSUMPTIONS: readonly Assumption[] = [
	{ file: 'bin/fm-brief.sh', marker: 'config/brief-include.md' }
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
			'Show the captain an HTML artifact as Firstmate’s own Lavish rule says, and a running app by reporting `preview <url>` (see Report a preview above).',
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
		`- A running app still reports \`preview <url>\` (see Report a preview above); Wheelhouse shows ${name}’s button as the primary action on that preview, with no preview helper or board link.`,
		`- How to use ${name} is the plugin’s own; see ${where}. When it cannot show something, tell the captain rather than quietly falling back to Lavish.`,
		`- Wheelhouse rewrites this section whenever the role changes: the captain chooses another plugin or the built-in, or turns ${name} off or removes it.`
	].join('\n');
}

/** A skill's files as installed: its bundled folder, with the review surface section in place. */
export async function renderSkill(
	skillsRoot: string,
	skill: SkillBundle,
	inputs: RenderInputs
): Promise<Tree> {
	const tree = await readTree(path.join(skillsRoot, skill.name));
	if (tree['SKILL.md'] === undefined) throw new Error(`${skill.name} has no SKILL.md`);
	tree['SKILL.md'] = tree['SKILL.md'].replace(REVIEW_SURFACE_MARKER, () =>
		reviewSurfaceSection(inputs.reviewSurface)
	);
	return tree;
}

/** The review surface in one line, for the worker block and the session context. */
function reviewSurfaceLine(surface: ReviewSurface | null): string {
	if (!surface) return 'the built-in: Wheelhouse’s own preview of what you report.';
	const name = plain(surface.name);
	return `${name} (the \`${surface.id}\` plugin), which the captain chose: use it instead of Lavish for anything shown to the captain; the wheelhouse-preview skill says how.`;
}

/**
 * The rules every worker brief carries, kept by Wheelhouse in a marked block of
 * the Firstmate home's `config/brief-include.md`, which Firstmate appends to
 * each ship and scout brief. Workers never see the chat or the session
 * context, so this is how they learn what the captain's Wheelhouse expects.
 * It must never carry a `Delivery contract: mode=` line: Firstmate refuses a
 * brief include that does, since the mode is each task's own.
 */
export function briefBlock(inputs: RenderInputs): string {
	return [
		'## Wheelhouse',
		'',
		'The captain follows this work in Wheelhouse, a web UI, not in your terminal.',
		'',
		'- Anything the captain should look at (a page, an app, a prototype, a report): serve it in the background (for example with `nohup`) on a port of its own on 127.0.0.1, and let Wheelhouse frame it: no `X-Frame-Options`, and no `frame-ancestors` that leaves Wheelhouse’s address out. Check it loads (`wheelhouse preview check <url>` says whether Wheelhouse can show it, and why not), then append `note [at=<epoch>]: preview http://127.0.0.1:<port>/<path>` as its own status line.',
		'- Keep a preview running until the work merges or closes. After any relaunch, start it again on the same port, check it with `curl`, and append the note again.',
		`- Review surface: ${reviewSurfaceLine(inputs.reviewSurface)}`,
		'- Secrets: only through `wh-vault run --only <NAME> -- <command>`. Never print, decode or ask for a value.',
		'- Never stop or restart Wheelhouse (no `pkill` or `kill` of its server). Stop only processes you started, by their saved PID.'
	].join('\n');
}

/**
 * What the Firstmate session Wheelhouse starts is told when it starts (and
 * after /clear, a compaction or a resume): that the captain reads it in
 * Wheelhouse, and the formats Wheelhouse renders. Under 400 tokens; the skills
 * hold the detail. Never written into Firstmate's home.
 */
export function sessionContext(inputs: ContextInputs): string {
	const at = inputs.url ? ` at ${inputs.url}` : '';
	return [
		`Wheelhouse ${inputs.version}${at} started this session. The captain reads your replies there as rendered Markdown, in a browser or on a phone, not in this terminal.`,
		'- Start each topic with `<!-- project: <id> -->` on its own line (`<!-- project: <id>/<task-id> -->` for one task).',
		'- End a reply that needs a choice with a fenced `decision-form`. Hold a real captain call as a captain-held task, so it reaches the Wheelhouse inbox.',
		'- Ask for a secret only with a `vault-request` block, never in words.',
		'- Link a preview as its loopback URL once it loads; workers report one with `note [at=<epoch>]: preview <url>`.',
		'- Write plain outcomes, not internals.',
		'- Answer a note Wheelhouse relayed with `fm-inbox.sh reply <note-id> -`.',
		`- Review surface: ${reviewSurfaceLine(inputs.reviewSurface)}`,
		'Load the manage-wheelhouse, wheelhouse-preview or wheelhouse-passage skill when its trigger applies.'
	].join('\n');
}
