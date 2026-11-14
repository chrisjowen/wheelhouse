import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	BUILTIN_COMMANDS,
	claudeConfigDir,
	frontMatter,
	shortDescription,
	slashCommands,
	userInvocable
} from './commands';

let dir: string;
let fm: string;
let env: NodeJS.ProcessEnv;

function write(file: string, text: string) {
	mkdirSync(path.dirname(file), { recursive: true });
	writeFileSync(file, text);
}

function skill(base: string, name: string, front: string) {
	mkdirSync(path.join(dir, base, name), { recursive: true });
	writeFileSync(path.join(dir, base, name, 'SKILL.md'), `---\n${front}\n---\n\n# ${name}\n`);
}

beforeEach(() => {
	dir = mkdtempSync(path.join(tmpdir(), 'wh-commands-'));
	fm = path.join(dir, 'firstmate');
	env = { HOME: path.join(dir, 'home') };
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const ids = (list: { source: string; plugin?: string; name: string }[]) =>
	list.map((c) => `${c.plugin ?? c.source}:${c.name}`);

describe('slashCommands', () => {
	it('offers every skill unless it opts out, as Claude Code does', async () => {
		skill(
			'firstmate/.agents/skills',
			'bearings',
			'name: bearings\ndescription: >-\n  Catch up on the fleet. Use when asked.\nuser-invocable: true'
		);
		skill('firstmate/.agents/skills', 'internal', 'name: internal\nuser-invocable: false');
		skill('firstmate/.agents/skills', 'quoted', 'name: quoted\nuser-invocable: "false"');
		skill('firstmate/.agents/skills', 'unmarked', 'name: unmarked\ndescription: No flag.');
		skill(
			'firstmate/.agents/skills',
			'quiet',
			'description: Hidden from Claude.\ndisable-model-invocation: true'
		);
		skill(
			'firstmate/.claude/skills',
			'bearings',
			'name: bearings\ndescription: Duplicate copy.\nuser-invocable: true'
		);
		write(path.join(fm, '.claude/commands/ship.md'), 'Ship the current branch.\n');
		write(path.join(fm, '.claude/commands/hush.md'), '---\nuser-invocable: false\n---\nNo.\n');
		const list = await slashCommands(fm, env);
		expect(ids(list)).toEqual([
			'firstmate:bearings',
			'firstmate:quiet',
			'firstmate:unmarked',
			'firstmate:ship',
			...BUILTIN_COMMANDS.map((c) => `builtin:${c.name}`)
		]);
		expect(list.find((c) => c.name === 'bearings')?.description).toBe('Duplicate copy.');
		expect(list.find((c) => c.name === 'ship')?.description).toBe('Ship the current branch.');
	});

	it('adds the captain’s own skills and commands, which win a shared name', async () => {
		skill('firstmate/.claude/skills', 'review', 'description: Firstmate’s review.');
		skill('home/.claude/skills', 'review', 'description: My review.');
		skill('home/.claude/skills', 'tdd', 'description: Test first.');
		skill('home/.claude/skills', 'secret', 'user-invocable: false');
		write(path.join(dir, 'home/.claude/commands/standup.md'), 'Write my standup.\n');
		write(path.join(dir, 'home/.claude/commands/compact.md'), 'My compact.\n');
		const list = await slashCommands(fm, env);
		expect(ids(list)).toEqual([
			'personal:review',
			'personal:tdd',
			'personal:compact',
			'personal:standup',
			...BUILTIN_COMMANDS.filter((c) => c.name !== 'compact').map((c) => `builtin:${c.name}`)
		]);
		expect(list[0].description).toBe('My review.');
	});

	it('reads the captain’s skills from $CLAUDE_CONFIG_DIR when it is set', async () => {
		skill('config/skills', 'mine', 'description: Mine.');
		skill('home/.claude/skills', 'ignored', 'description: Not this one.');
		env.CLAUDE_CONFIG_DIR = path.join(dir, 'config');
		expect(claudeConfigDir(env)).toBe(path.join(dir, 'config'));
		expect(ids(await slashCommands(fm, env)).filter((n) => !n.startsWith('builtin:'))).toEqual([
			'personal:mine'
		]);
	});

	it('adds enabled plugins’ skills and commands, named plugin:name', async () => {
		const config = path.join(dir, 'home/.claude');
		const install = (name: string) => path.join(config, 'plugins/cache', name);
		const entry = (name: string, extra = {}) => [
			{ scope: 'user', installPath: install(name), ...extra }
		];
		write(
			path.join(config, 'plugins/installed_plugins.json'),
			JSON.stringify({
				version: 2,
				plugins: {
					'superpowers@official': entry('superpowers'),
					'tools@acme': entry('tools'),
					'off@acme': entry('off'),
					'other@acme': [
						{ scope: 'project', installPath: install('other'), projectPath: '/elsewhere' }
					],
					'here@acme': [{ scope: 'project', installPath: install('here'), projectPath: fm }]
				}
			})
		);
		write(
			path.join(config, 'settings.json'),
			JSON.stringify({
				enabledPlugins: {
					'superpowers@official': true,
					'tools@acme': true,
					'off@acme': true,
					'other@acme': true,
					'here@acme': true
				}
			})
		);
		write(
			path.join(fm, '.claude/settings.json'),
			JSON.stringify({ enabledPlugins: { 'off@acme': false } })
		);
		skill('home/.claude/plugins/cache/superpowers/skills', 'brainstorming', 'description: Think.');
		skill('home/.claude/plugins/cache/superpowers/skills', 'background', 'user-invocable: false');
		write(
			path.join(install('tools'), '.claude-plugin/plugin.json'),
			JSON.stringify({ name: 'acme-tools', skills: ['./extra/lint'] })
		);
		skill('home/.claude/plugins/cache/tools/extra', 'lint', 'description: Lint it.');
		write(path.join(install('tools'), 'commands/commit.md'), 'Create a commit.\n');
		skill('home/.claude/plugins/cache/off/skills', 'nope', 'description: Disabled.');
		skill('home/.claude/plugins/cache/other/skills', 'nope', 'description: Another project.');
		skill('home/.claude/plugins/cache/here/skills', 'local', 'description: This project.');
		skill('firstmate/.claude/skills', 'bearings', 'description: Catch up.');
		const list = await slashCommands(fm, env);
		expect(ids(list)).toEqual([
			'firstmate:bearings',
			'superpowers:superpowers:brainstorming',
			'acme-tools:acme-tools:lint',
			'acme-tools:acme-tools:commit',
			'here:here:local',
			...BUILTIN_COMMANDS.map((c) => `builtin:${c.name}`)
		]);
		expect(list[1]).toEqual({
			name: 'superpowers:brainstorming',
			description: 'Think.',
			source: 'plugin',
			plugin: 'superpowers'
		});
	});

	it('offers only the built-ins when there is nothing else', async () => {
		expect(await slashCommands(path.join(dir, 'missing'), env)).toEqual(BUILTIN_COMMANDS);
	});
});

describe('userInvocable', () => {
	it('is on unless the front matter turns it off', () => {
		expect(userInvocable({})).toBe(true);
		expect(userInvocable({ 'user-invocable': true })).toBe(true);
		expect(userInvocable({ 'disable-model-invocation': true })).toBe(true);
		expect(userInvocable({ 'user-invocable': false })).toBe(false);
		expect(userInvocable({ 'user-invocable': 'false' })).toBe(false);
		expect(userInvocable({ user_invocable: false })).toBe(false);
	});
});

describe('descriptions', () => {
	it('keep the first sentence, cut to a readable length', () => {
		expect(shortDescription('Catch up. Then more detail.')).toBe('Catch up.');
		expect(shortDescription('x'.repeat(200))).toHaveLength(110);
		expect(shortDescription(undefined)).toBe('');
	});

	it('reads YAML front matter, or nothing', () => {
		expect(frontMatter('---\na: 1\n---\nbody')).toEqual({ a: 1 });
		expect(frontMatter('no front matter')).toBeNull();
		expect(frontMatter('---\n: : bad\n---\n')).toBeNull();
	});
});
