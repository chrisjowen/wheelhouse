import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'yaml';
import type { SlashCommand } from '../../types';

/**
 * The slash commands the composer offers: Firstmate's own (the skills it marks
 * `user-invocable: true` and any `.claude/commands/*.md` in its checkout), then
 * the Claude Code built-ins that work from a chat. Built-ins that open an
 * interactive picker in the terminal (/model, /mcp, /agents, /config, /resume,
 * /memory) are left out: the chat cannot show those, and the terminal drawer
 * can.
 */

export const BUILTIN_COMMANDS: SlashCommand[] = [
	{ name: 'compact', description: 'Summarise the conversation to free up room', source: 'claude' },
	{ name: 'clear', description: 'Start a fresh conversation', source: 'claude' },
	{ name: 'context', description: 'Show how full the conversation is', source: 'claude' }
];

const NAME = /^[a-z0-9][a-z0-9_.:-]{0,63}$/i;
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

async function skills(dir: string): Promise<SlashCommand[]> {
	let names: string[];
	try {
		names = await readdir(dir);
	} catch {
		return [];
	}
	const out: SlashCommand[] = [];
	for (const n of names.sort()) {
		try {
			const fm = frontMatter(await readFile(path.join(dir, n, 'SKILL.md'), 'utf8'));
			if (!fm || fm['user-invocable'] !== true) continue;
			const name = typeof fm.name === 'string' ? fm.name : n;
			if (!NAME.test(name)) continue;
			out.push({ name, description: shortDescription(fm.description), source: 'firstmate' });
		} catch {
			// not a skill
		}
	}
	return out;
}

async function commandFiles(dir: string): Promise<SlashCommand[]> {
	let names: string[];
	try {
		names = await readdir(dir);
	} catch {
		return [];
	}
	const out: SlashCommand[] = [];
	for (const f of names.sort()) {
		if (!f.endsWith('.md')) continue;
		const name = f.slice(0, -3);
		if (!NAME.test(name)) continue;
		try {
			const text = await readFile(path.join(dir, f), 'utf8');
			const fm = frontMatter(text);
			const body = text.replace(/^---[\s\S]*?---\s*/, '');
			out.push({
				name,
				description: shortDescription(fm?.description ?? body.split('\n').find((l) => l.trim())),
				source: 'firstmate'
			});
		} catch {
			// unreadable
		}
	}
	return out;
}

/** Every command the composer offers for Firstmate's checkout, Firstmate's first. */
export async function slashCommands(firstmateDir: string): Promise<SlashCommand[]> {
	const found = [
		...(await skills(path.join(firstmateDir, '.claude', 'skills'))),
		...(await skills(path.join(firstmateDir, '.agents', 'skills'))),
		...(await commandFiles(path.join(firstmateDir, '.claude', 'commands')))
	];
	const seen = new Set<string>();
	const own = found.filter((c) => !seen.has(c.name) && seen.add(c.name));
	return [...own, ...BUILTIN_COMMANDS.filter((c) => !seen.has(c.name))];
}
