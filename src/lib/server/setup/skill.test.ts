import { mkdtemp, mkdir, readFile, writeFile, rm, symlink, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installWheelhouseSkill } from './skill';

let root: string;
let env: NodeJS.ProcessEnv;
let source: string;
let target: string;
let install: { firstmateDir: string; homeDir: string };
beforeEach(async () => {
	root = await mkdtemp(path.join(tmpdir(), 'wh-skill-test-'));
	env = { HOME: path.join(root, 'user') };
	source = path.join(root, 'bundle');
	target = path.join(env.HOME!, '.claude/skills/manage-wheelhouse');
	install = { firstmateDir: path.join(root, 'code'), homeDir: path.join(root, 'home') };
	await mkdir(path.join(source, 'references'), { recursive: true });
	await writeFile(path.join(source, 'SKILL.md'), 'skill v1');
	await writeFile(path.join(source, 'references/operations.md'), 'reference v1');
});
afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});
const apply = () => installWheelhouseSkill(install, env, source);

describe('the bundled Firstmate user skill', () => {
	it('installs all linked material outside both Firstmate directories, and is idempotent', async () => {
		expect((await apply()).state).toBe('installed');
		expect(await readFile(path.join(target, 'references/operations.md'), 'utf8')).toBe(
			'reference v1'
		);
		expect((await apply()).state).toBe('current');
		expect(await readdir(root)).toEqual(expect.not.arrayContaining(['code', 'home']));
	});

	it('refreshes the complete unchanged bundle, even if the package version has not changed', async () => {
		await apply();
		await writeFile(path.join(source, 'SKILL.md'), 'skill v2');
		await writeFile(path.join(source, 'references/operations.md'), 'reference v2');
		expect((await apply()).state).toBe('updated');
		expect(await readFile(path.join(target, 'SKILL.md'), 'utf8')).toBe('skill v2');
		expect(await readFile(path.join(target, 'references/operations.md'), 'utf8')).toBe(
			'reference v2'
		);
		expect((await apply()).state).toBe('current');
	});

	it.each(['SKILL.md', 'references/operations.md', 'extra.md', '.wheelhouse-managed.json'])(
		'preserves a locally changed %s and the whole previous bundle',
		async (file) => {
			await apply();
			await writeFile(path.join(target, file), 'local edit');
			await writeFile(path.join(source, 'SKILL.md'), 'skill v2');
			const result = await apply();
			expect(result.state).toBe('skipped');
			expect(result.message).toContain('locally edited');
			expect(await readFile(path.join(target, file), 'utf8')).toBe('local edit');
			expect(await readFile(path.join(target, 'references/operations.md'), 'utf8')).toBe(
				file === 'references/operations.md' ? 'local edit' : 'reference v1'
			);
		}
	);

	it('does not adopt an existing unowned copy', async () => {
		await mkdir(target, { recursive: true });
		await writeFile(path.join(target, 'SKILL.md'), 'my skill');
		expect((await apply()).state).toBe('skipped');
		expect(await readFile(path.join(target, 'SKILL.md'), 'utf8')).toBe('my skill');
	});

	it('honours the Claude user config directory and the opt-out', async () => {
		env.CLAUDE_CONFIG_DIR = path.join(root, 'custom-claude');
		expect((await apply()).state).toBe('installed');
		expect(
			await readFile(path.join(env.CLAUDE_CONFIG_DIR, 'skills/manage-wheelhouse/SKILL.md'), 'utf8')
		).toBe('skill v1');
		env.WHEELHOUSE_MANAGE_SKILL = '0';
		await writeFile(path.join(source, 'SKILL.md'), 'skill v2');
		expect((await apply()).state).toBe('disabled');
	});

	it('refuses a user config inside the checkout or a symlink into the home', async () => {
		env.CLAUDE_CONFIG_DIR = path.join(install.firstmateDir, '.claude');
		expect((await apply()).state).toBe('skipped');
		await mkdir(install.homeDir, { recursive: true });
		env.CLAUDE_CONFIG_DIR = path.join(root, 'linked-config');
		await symlink(install.homeDir, env.CLAUDE_CONFIG_DIR);
		expect((await apply()).state).toBe('skipped');
		expect(await readdir(install.homeDir)).toEqual([]);
	});

	it('preserves a symlinked existing skill', async () => {
		await mkdir(path.dirname(target), { recursive: true });
		await symlink(source, target);
		expect((await apply()).state).toBe('skipped');
		expect(await readFile(path.join(source, 'SKILL.md'), 'utf8')).toBe('skill v1');
	});

	it('reports a missing bundle and leaves the installed version intact', async () => {
		await apply();
		await rm(path.join(source, 'references/operations.md'));
		expect((await apply()).state).toBe('error');
		expect(await readFile(path.join(target, 'SKILL.md'), 'utf8')).toBe('skill v1');
	});
});
