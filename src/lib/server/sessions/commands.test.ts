import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BUILTIN_COMMANDS, frontMatter, shortDescription, slashCommands } from './commands';

let dir: string;

function skill(base: string, name: string, front: string) {
	mkdirSync(path.join(dir, base, name), { recursive: true });
	writeFileSync(path.join(dir, base, name, 'SKILL.md'), `---\n${front}\n---\n\n# ${name}\n`);
}

beforeEach(() => {
	dir = mkdtempSync(path.join(tmpdir(), 'wh-commands-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('slashCommands', () => {
	it('offers Firstmate’s user-invocable skills and commands, then Claude Code’s', async () => {
		skill(
			'.agents/skills',
			'bearings',
			'name: bearings\ndescription: >-\n  Catch up on the fleet. Use when asked.\nuser-invocable: true'
		);
		skill(
			'.agents/skills',
			'internal',
			'name: internal\ndescription: Not for the captain.\nuser-invocable: false'
		);
		skill('.agents/skills', 'unmarked', 'name: unmarked\ndescription: No flag.');
		skill(
			'.claude/skills',
			'bearings',
			'name: bearings\ndescription: Duplicate copy.\nuser-invocable: true'
		);
		mkdirSync(path.join(dir, '.claude/commands'), { recursive: true });
		writeFileSync(path.join(dir, '.claude/commands', 'ship.md'), 'Ship the current branch.\n');
		const list = await slashCommands(dir);
		expect(list.map((c) => `${c.source}:${c.name}`)).toEqual([
			'firstmate:bearings',
			'firstmate:ship',
			...BUILTIN_COMMANDS.map((c) => `claude:${c.name}`)
		]);
		expect(list.find((c) => c.name === 'bearings')?.description).toBe('Duplicate copy.');
		expect(list.find((c) => c.name === 'ship')?.description).toBe('Ship the current branch.');
	});

	it('offers only the built-ins when Firstmate has none', async () => {
		expect(await slashCommands(path.join(dir, 'missing'))).toEqual(BUILTIN_COMMANDS);
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
