import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parseCrewSettings } from '$lib/live/tools';
import { crewLaunch, crewToolsView, LOCKED_TOOLS, readMcpHealth, saveCrewSettings } from './tools';

let dir = '';
afterEach(async () => {
	if (dir) await rm(dir, { recursive: true, force: true });
	dir = '';
});

/** A fake home with Claude Code's config and a skill, and Firstmate's home beside it. */
async function setup() {
	dir = await mkdtemp(path.join(os.tmpdir(), 'wheelhouse-crew-tools-'));
	const home = path.join(dir, 'fm');
	await mkdir(home);
	await writeFile(
		path.join(dir, '.claude.json'),
		JSON.stringify({
			mcpServers: { giffy: { command: 'node' } },
			projects: { [home]: { mcpServers: { docket: { type: 'http', url: 'http://x' } } } }
		})
	);
	await mkdir(path.join(dir, '.claude', 'skills', 'grill-me'), { recursive: true });
	await writeFile(
		path.join(dir, '.claude', 'skills', 'grill-me', 'SKILL.md'),
		'---\nname: grill-me\ndescription: Stress-test a plan\n---\n'
	);
	return { home, env: { HOME: dir }, configDir: path.join(dir, 'config') };
}

describe('the discussion crew’s tools', () => {
	it('reads which MCP servers connect', () => {
		const h = readMcpHealth(
			'Checking MCP server health…\n\ndocket: http://127.0.0.1:4728/mcp (HTTP) - ✘ Failed to connect\nplugin:a:b: https://x (HTTP) - ✔ Connected\n'
		);
		expect(h.get('docket')).toBe(false);
		expect(h.get('plugin:a:b')).toBe(true);
	});

	it('keeps only sane settings', () => {
		expect(
			parseCrewSettings({
				tools: { webSearch: false },
				mcp: { ok: true, 'bad name!': true },
				skills: ['a', 'a', 3]
			})
		).toEqual({
			tools: { webSearch: false, webFetch: true, files: true },
			mcp: { ok: true },
			skills: ['a']
		});
	});

	it('lists servers on by default unless they fail, and skills off until picked', async () => {
		const s = await setup();
		const health = async () => new Map([['docket', false]]);
		const view = await crewToolsView({ ...s, health }, null);
		expect(view.mcp).toEqual([
			{ name: 'docket', on: false, connects: false },
			{ name: 'giffy', on: true, connects: null }
		]);
		expect(view.skills).toEqual([
			{ name: 'grill-me', description: 'Stress-test a plan', on: false }
		]);
	});

	it('launches with exactly what is chosen, and never a shell or writing', async () => {
		const s = await setup();
		const health = async () => new Map<string, boolean>();
		await saveCrewSettings(s.configDir, {
			tools: { webSearch: false },
			mcp: { docket: false },
			skills: ['grill-me']
		});
		const launch = await crewLaunch({ ...s, health }, null);
		expect(launch.tools).toEqual(['WebFetch', 'Read', 'Grep', 'Glob', 'Skill']);
		expect(launch.allowed).toContain('mcp__giffy');
		expect(launch.allowed).not.toContain('mcp__docket');
		expect(launch.mcpConfig).toEqual({ mcpServers: { giffy: { command: 'node' } } });
		expect(launch.skills.map((k) => k.name)).toEqual(['grill-me']);
		expect(launch.readable).toEqual([s.home]);
		for (const locked of LOCKED_TOOLS) expect(launch.tools).not.toContain(locked);
	});
});
