import { readdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { parse } from 'yaml';
import type { SlashCommand } from '../../types';

/**
 * The slash commands the composer offers: every skill and command the
 * Firstmate session can run, as Claude Code finds them. That is Firstmate's
 * checkout (`.claude/skills`, `.agents/skills`, `.claude/commands`), the
 * captain's own (`skills/` and `commands/` in `$CLAUDE_CONFIG_DIR`, else
 * `~/.claude`), the enabled plugins' (named `plugin:skill`), then the Claude
 * Code built-ins that work from a chat. A skill is offered unless its front
 * matter says `user-invocable: false`, which is Claude Code's default.
 * Built-ins that open an interactive picker in the terminal (/model, /mcp,
 * /agents, /config, /resume, /memory) are left out: the chat cannot drive
 * those, and the terminal drawer can. Typed anyway, the chat offers to close
 * them (see picker.ts).
 */

export const BUILTIN_COMMANDS: SlashCommand[] = [
	{ name: 'compact', description: 'Summarise the conversation to free up room', source: 'builtin' },
	{ name: 'clear', description: 'Start a fresh conversation', source: 'builtin' },
	{ name: 'context', description: 'Show how full the conversation is', source: 'builtin' }
];

const NAME = /^[a-z0-9][a-z0-9_.:-]{0,127}$/i;
const MAX_DESCRIPTION = 110;

/** A command's description, cut to its first sentence and a readable length. */
export function shortDescription(text: unknown): string {
	const flat = String(text ?? '')
		.replace(/\s+/g, ' ')
		.trim();
	const sentence = flat.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? flat;
	return sentence.length > MAX_DESCRIPTION
		? `${sentence.slice(0, MAX_DESCRIPTION - 1).trimEnd()}…`
		: sentence;
}

/** The YAML front matter of a Markdown file, or null. */
export function frontMatter(text: string): Record<string, unknown> | null {
	const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
	if (!m) return null;
	try {
		const v = parse(m[1]) as unknown;
		return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
	} catch {
		return null;
	}
}

type Origin = Pick<SlashCommand, 'source' | 'plugin'>;

/** Whether a skill's front matter lets the captain type it: yes unless it says not. */
export function userInvocable(fm: Record<string, unknown>): boolean {
	const flag = fm['user-invocable'] ?? fm.user_invocable;
	return flag !== false && flag !== 'false';
}

async function list(dir: string): Promise<string[]> {
	try {
		return (await readdir(dir)).sort();
	} catch {
		return [];
	}
}

/** The skill in `dir` (its `SKILL.md`), or null when it has none or keeps it from the captain. */
async function skillIn(dir: string, origin: Origin, prefix: string): Promise<SlashCommand | null> {
	try {
		const fm = frontMatter(await readFile(path.join(dir, 'SKILL.md'), 'utf8')) ?? {};
		if (!userInvocable(fm)) return null;
		const own = typeof fm.name === 'string' && fm.name.trim() ? fm.name.trim() : path.basename(dir);
		const name = prefix + own;
		return NAME.test(name)
			? { name, description: shortDescription(fm.description), ...origin }
			: null;
	} catch {
		return null; // not a skill
	}
}

/** The skills in `dir`: one per folder, or `dir` itself when it is one skill's folder. */
async function skills(dir: string, origin: Origin, prefix = ''): Promise<SlashCommand[]> {
	const own = await skillIn(dir, origin, prefix);
	if (own) return [own];
	const out: SlashCommand[] = [];
	for (const n of await list(dir)) {
		const skill = await skillIn(path.join(dir, n), origin, prefix);
		if (skill) out.push(skill);
	}
	return out;
}

async function commandFiles(dir: string, origin: Origin, prefix = ''): Promise<SlashCommand[]> {
	const out: SlashCommand[] = [];
	for (const f of await list(dir)) {
		if (!f.endsWith('.md')) continue;
		const name = prefix + f.slice(0, -3);
		if (!NAME.test(name)) continue;
		try {
			const text = await readFile(path.join(dir, f), 'utf8');
			const fm = frontMatter(text);
			if (fm && !userInvocable(fm)) continue;
			const body = text.replace(/^---[\s\S]*?---\s*/, '');
			out.push({
				name,
				description: shortDescription(fm?.description ?? body.split('\n').find((l) => l.trim())),
				...origin
			});
		} catch {
			// unreadable
		}
	}
	return out;
}

async function readJson(file: string): Promise<Record<string, unknown> | null> {
	try {
		const v = JSON.parse(await readFile(file, 'utf8')) as unknown;
		return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
	} catch {
		return null;
	}
}

const record = (v: unknown): Record<string, unknown> =>
	v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

const paths = (v: unknown): string[] =>
	(Array.isArray(v) ? v : [v]).filter((p): p is string => typeof p === 'string' && !!p);

/**
 * The enabled plugins' skills and commands, as `plugin:name`. A plugin is
 * enabled when the captain's settings or Firstmate's project settings say so
 * (the project's win), and installed for the captain or for Firstmate's checkout.
 */
async function pluginCommands(configDir: string, firstmateDir: string): Promise<SlashCommand[]> {
	const enabled: Record<string, unknown> = {};
	for (const file of [
		path.join(configDir, 'settings.json'),
		path.join(firstmateDir, '.claude', 'settings.json'),
		path.join(firstmateDir, '.claude', 'settings.local.json')
	]) {
		Object.assign(enabled, record((await readJson(file))?.enabledPlugins));
	}
	const installed = record(
		(await readJson(path.join(configDir, 'plugins', 'installed_plugins.json')))?.plugins
	);
	const root = path.resolve(firstmateDir);
	const out: SlashCommand[] = [];
	for (const [key, entries] of Object.entries(installed)) {
		if (enabled[key] !== true || !Array.isArray(entries)) continue;
		const install = entries
			.map(record)
			.find(
				(e) =>
					typeof e.installPath === 'string' &&
					(e.scope === 'user' ||
						(typeof e.projectPath === 'string' && path.resolve(e.projectPath) === root))
			)?.installPath as string | undefined;
		if (!install) continue;
		const manifest = await readJson(path.join(install, '.claude-plugin', 'plugin.json'));
		const plugin =
			typeof manifest?.name === 'string' && manifest.name ? manifest.name : key.split('@')[0];
		const origin: Origin = { source: 'plugin', plugin };
		const prefix = `${plugin}:`;
		const within = (p: string) => path.resolve(install, p);
		for (const dir of new Set(['skills', ...paths(manifest?.skills)].map(within))) {
			out.push(...(await skills(dir, origin, prefix)));
		}
		for (const dir of new Set(['commands', ...paths(manifest?.commands)].map(within))) {
			out.push(...(await commandFiles(dir, origin, prefix)));
		}
	}
	return out;
}

/** Claude Code's config directory: `$CLAUDE_CONFIG_DIR`, else `~/.claude`. */
export const claudeConfigDir = (env: NodeJS.ProcessEnv): string =>
	path.resolve(env.CLAUDE_CONFIG_DIR || path.join(env.HOME || homedir(), '.claude'));

/**
 * Every command the composer offers, grouped Firstmate, the captain's own,
 * each plugin, then the built-ins. Where two share a name, the one Claude Code
 * runs is kept: the captain's over Firstmate's, a skill over a command file,
 * and either over a built-in.
 */
export async function slashCommands(
	firstmateDir: string,
	env: NodeJS.ProcessEnv = process.env
): Promise<SlashCommand[]> {
	const config = claudeConfigDir(env);
	const firstmate: Origin = { source: 'firstmate' };
	const personal: Origin = { source: 'personal' };
	const ranked = [
		...(await skills(path.join(config, 'skills'), personal)),
		...(await skills(path.join(firstmateDir, '.claude', 'skills'), firstmate)),
		...(await skills(path.join(firstmateDir, '.agents', 'skills'), firstmate)),
		...(await commandFiles(path.join(config, 'commands'), personal)),
		...(await commandFiles(path.join(firstmateDir, '.claude', 'commands'), firstmate)),
		...BUILTIN_COMMANDS,
		...(await pluginCommands(config, firstmateDir))
	];
	const seen = new Set<string>();
	const kept = ranked.filter((c) => !seen.has(c.name) && seen.add(c.name));
	const order = (c: SlashCommand) =>
		c.source === 'firstmate' ? 0 : c.source === 'personal' ? 1 : c.source === 'plugin' ? 2 : 3;
	return kept
		.map((c, i) => ({ c, i }))
		.sort((a, b) => order(a.c) - order(b.c) || a.i - b.i)
		.map(({ c }) => c);
}
