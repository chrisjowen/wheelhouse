import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { runBounded } from '../firstmate/exec';
import { uploadsDir } from '../uploads';
import {
	DEFAULT_CREW_TOOLS,
	parseCrewSettings,
	type CrewSettings,
	type CrewToolsView
} from '$lib/live/tools';

/**
 * What the discussion crew may use, chosen in Settings → Discussion: web
 * search, web fetch and read-only file access to the Firstmate home and its
 * project clones; the MCP servers Firstmate's Claude Code has configured (each
 * on unless it fails to connect); and any of the captain's own installed
 * skills (none unless picked). Changing the fleet is never possible: the crew
 * gets no shell, no file writing and no way to start, steer, merge or tear
 * down work, whatever is chosen here. Firstmate's own skills and hooks are
 * never offered. Whatever is chosen, the crew may read the files the captain
 * attaches in Live mode (Wheelhouse's uploads folder, and nothing else when
 * file access is off).
 */

export const CREW_FILE = 'discussion.json';

/** Built-in Claude Code tools each switch turns on. */
const TOOL_NAMES: Record<keyof CrewSettings['tools'], string[]> = {
	webSearch: ['WebSearch'],
	webFetch: ['WebFetch'],
	files: ['Read', 'Grep', 'Glob']
};

/** Never handed to the crew, whatever is chosen. */
export const LOCKED_TOOLS = ['Bash', 'Write', 'Edit', 'NotebookEdit', 'Task', 'Agent'];

export interface McpServer {
	name: string;
	config: Record<string, unknown>;
}

export interface Skill {
	name: string;
	description: string;
	dir: string;
}

export interface ToolDeps {
	configDir: string;
	/** Firstmate's operational home: its Claude Code project config and project clones. */
	home: string;
	env?: NodeJS.ProcessEnv;
	/** `claude mcp list` in the home, for which servers connect; injected in tests. */
	health?: () => Promise<Map<string, boolean>>;
}

async function readJsonFile(file: string): Promise<Record<string, unknown> | null> {
	try {
		const v: unknown = JSON.parse(await readFile(file, 'utf8'));
		return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
	} catch {
		return null;
	}
}

const servers = (v: unknown): Record<string, Record<string, unknown>> =>
	v && typeof v === 'object' && !Array.isArray(v)
		? (v as Record<string, Record<string, unknown>>)
		: {};

/** The MCP servers Claude Code uses in Firstmate's home: user, local and project scopes. */
export async function firstmateMcpServers(home: string, env = process.env): Promise<McpServer[]> {
	const user = await readJsonFile(path.join(env.HOME ?? homedir(), '.claude.json'));
	const project = await readJsonFile(path.join(home, '.mcp.json'));
	const projects = servers(user?.projects);
	const local = servers(projects[home]?.mcpServers ?? projects[path.resolve(home)]?.mcpServers);
	const all = { ...servers(user?.mcpServers), ...servers(project?.mcpServers), ...local };
	return Object.entries(all)
		.filter(
			([name, config]) =>
				/^[A-Za-z0-9_.-]{1,64}$/.test(name) && config && typeof config === 'object'
		)
		.map(([name, config]) => ({ name, config }))
		.sort((a, b) => a.name.localeCompare(b.name));
}

/** Which servers connect, from `claude mcp list` (name: target - ✔ Connected / ✘ Failed …). Pure. */
export function readMcpHealth(out: string): Map<string, boolean> {
	const health = new Map<string, boolean>();
	for (const line of out.split('\n')) {
		const m = /^(.+?): .* - (.+)$/.exec(line.trim());
		if (m) health.set(m[1], /connected/i.test(m[2]) && !/fail/i.test(m[2]));
	}
	return health;
}

let healthCache: { at: number; home: string; health: Map<string, boolean> } | null = null;

async function mcpHealth(home: string, claude: string | null): Promise<Map<string, boolean>> {
	if (healthCache && healthCache.home === home && Date.now() - healthCache.at < 10 * 60_000)
		return healthCache.health;
	if (!claude) return new Map();
	const r = await runBounded(claude, ['mcp', 'list'], {
		cwd: home,
		timeoutMs: 45_000,
		maxOutputBytes: 256 * 1024
	});
	const health = readMcpHealth(r.stdout);
	healthCache = { at: Date.now(), home, health };
	return health;
}

/** The captain's own installed skills (Firstmate's are not offered). */
export async function installedSkills(env = process.env): Promise<Skill[]> {
	const root = path.join(env.HOME ?? homedir(), '.claude', 'skills');
	const out: Skill[] = [];
	for (const name of await readdir(root).catch(() => [] as string[])) {
		const dir = path.join(root, name);
		const text = await readFile(path.join(dir, 'SKILL.md'), 'utf8').catch(() => null);
		if (!text || !/^[A-Za-z0-9_.:-]{1,64}$/.test(name)) continue;
		const description = /^description:\s*(.+)$/m.exec(text)?.[1]?.replace(/^["']|["']$/g, '') ?? '';
		out.push({ name, description: description.slice(0, 240), dir });
	}
	return out.sort((a, b) => a.name.localeCompare(b.name));
}

export async function readCrewSettings(configDir: string): Promise<CrewSettings> {
	return parseCrewSettings(await readJsonFile(path.join(configDir, CREW_FILE)));
}

export async function saveCrewSettings(configDir: string, raw: unknown): Promise<CrewSettings> {
	const settings = parseCrewSettings(raw);
	await mkdir(configDir, { recursive: true });
	const target = path.join(configDir, CREW_FILE);
	const temporary = `${target}.${randomUUID()}.tmp`;
	try {
		await writeFile(temporary, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 });
		await rename(temporary, target);
	} catch (error) {
		await unlink(temporary).catch(() => {});
		throw error;
	}
	return settings;
}

/** Whether an MCP server is on: as the captain set it, else on unless it failed to connect. */
const serverOn = (settings: CrewSettings, name: string, health: Map<string, boolean>) =>
	settings.mcp[name] ?? health.get(name) !== false;

/** Settings → Discussion as the page shows it. */
export async function crewToolsView(deps: ToolDeps, claude: string | null): Promise<CrewToolsView> {
	const env = deps.env ?? process.env;
	const settings = await readCrewSettings(deps.configDir);
	const [list, health, skills] = await Promise.all([
		firstmateMcpServers(deps.home, env),
		deps.health ? deps.health() : mcpHealth(deps.home, claude),
		installedSkills(env)
	]);
	return {
		settings,
		mcp: list.map((s) => ({
			name: s.name,
			on: serverOn(settings, s.name, health),
			connects: health.has(s.name) ? health.get(s.name)! : null
		})),
		skills: skills.map((s) => ({
			name: s.name,
			description: s.description,
			on: settings.skills.includes(s.name)
		}))
	};
}

export interface CrewLaunch {
	/** Built-in tools available (`--tools`). */
	tools: string[];
	/** Tools allowed without asking (`--allowedTools`). */
	allowed: string[];
	/** The MCP servers to load, as an `--mcp-config` document, or null for none. */
	mcpConfig: { mcpServers: Record<string, Record<string, unknown>> } | null;
	/** Skill folders to make available. */
	skills: Skill[];
	/** Folders the crew may read. */
	readable: string[];
}

/** Read only inside a folder: a Claude Code permission rule (an absolute path is written `//…`). */
const readInside = (dir: string) => `Read(/${dir.split(path.sep).join('/')}/**)`;

/** Exactly what the crew launches with, from the settings. Pure but for reading the lists. */
export async function crewLaunch(deps: ToolDeps, claude: string | null): Promise<CrewLaunch> {
	const env = deps.env ?? process.env;
	const settings = await readCrewSettings(deps.configDir);
	const tools: string[] = [];
	for (const [key, names] of Object.entries(TOOL_NAMES) as [
		keyof CrewSettings['tools'],
		string[]
	][])
		if (settings.tools[key]) tools.push(...names);
	const list = await firstmateMcpServers(deps.home, env);
	const health = deps.health ? await deps.health() : await mcpHealth(deps.home, claude);
	const chosen = list.filter((s) => serverOn(settings, s.name, health));
	const skills = (await installedSkills(env)).filter((s) => settings.skills.includes(s.name));
	if (skills.length) tools.push('Skill');
	// Files attached in Live mode: there before the crew starts, so it may open them later.
	const uploads = uploadsDir(env);
	await mkdir(uploads, { recursive: true, mode: 0o700 }).catch(() => {});
	const allowed = [...tools, ...chosen.map((s) => `mcp__${s.name}`)];
	if (!tools.includes('Read')) {
		tools.push('Read');
		allowed.push(readInside(uploads));
	}
	return {
		tools,
		allowed,
		mcpConfig: chosen.length
			? { mcpServers: Object.fromEntries(chosen.map((s) => [s.name, s.config])) }
			: null,
		skills,
		readable: [...(settings.tools.files && existsSync(deps.home) ? [deps.home] : []), uploads]
	};
}

export { DEFAULT_CREW_TOOLS };
