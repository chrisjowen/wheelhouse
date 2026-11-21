import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { materialDir, readManifest } from '../src/lib/server/material/manifest';
import { skillsCommand } from './skills';

let root: string;
let env: NodeJS.ProcessEnv;
let source: string;
let target: string;
let out: string[];
let err: string[];
let asked: string[];
let answer: boolean;
const ID = 'skill:manage-wheelhouse@claude';

beforeEach(async () => {
	root = await mkdtemp(path.join(tmpdir(), 'wh-skills-cli-'));
	env = { HOME: path.join(root, 'user'), WHEELHOUSE_CONFIG_DIR: path.join(root, 'config') };
	source = path.join(root, 'skills/manage-wheelhouse');
	target = path.join(env.HOME!, '.claude/skills/manage-wheelhouse');
	out = [];
	err = [];
	asked = [];
	answer = true;
	process.exitCode = undefined;
	await mkdir(path.join(source, 'references'), { recursive: true });
	await writeFile(path.join(source, 'SKILL.md'), 'skill v1\n');
	await writeFile(path.join(source, 'references/operations.md'), 'reference v1\n');
	for (const name of ['wheelhouse-preview', 'wheelhouse-passage']) {
		await mkdir(path.join(root, 'skills', name), { recursive: true });
		await writeFile(path.join(root, 'skills', name, 'SKILL.md'), `${name} v1\n`);
	}
	const firstmate = path.join(root, 'firstmate');
	await mkdir(path.join(firstmate, 'bin'), { recursive: true });
	await writeFile(
		path.join(firstmate, 'bin/fm-inbox.sh'),
		'fm-inbox.sh reply\nfm-inbox.sh receipts\n'
	);
	await writeFile(path.join(firstmate, 'bin/fm-captain-hold.sh'), 'fm-captain-hold.sh hold\n');
	await writeFile(path.join(firstmate, 'bin/fm-brief.sh'), '# appends config/brief-include.md\n');
	await mkdir(env.WHEELHOUSE_CONFIG_DIR!, { recursive: true });
	await writeFile(
		path.join(env.WHEELHOUSE_CONFIG_DIR!, 'firstmate.json'),
		JSON.stringify({ firstmate, home: firstmate })
	);
});
afterEach(async () => {
	process.exitCode = undefined;
	await rm(root, { recursive: true, force: true });
});

async function skills(...args: string[]) {
	out = [];
	err = [];
	await skillsCommand({
		env,
		skillsRoot: path.join(root, 'skills'),
		confirm: async (q) => {
			asked.push(q);
			return answer;
		},
		log: (l) => out.push(l),
		error: (l) => err.push(l)
	})
		.exitOverride()
		.parseAsync(args, { from: 'user' });
	return out.join('\n');
}

describe('wheelhouse skills', () => {
	it('refuses until Wheelhouse knows its Firstmate', async () => {
		await rm(path.join(env.WHEELHOUSE_CONFIG_DIR!, 'firstmate.json'));
		await skills('status');
		expect(err.join('\n')).toContain('not connected to a Firstmate yet');
		expect(process.exitCode).toBe(1);
	});

	it('reports an unreadable manifest as an error instead of crashing', async () => {
		await mkdir(path.join(materialDir(env.WHEELHOUSE_CONFIG_DIR!), 'manifest.json'), {
			recursive: true
		});
		for (const cmd of ['status', 'sync']) {
			process.exitCode = undefined;
			await skills(cmd);
			expect(err.join('\n')).toContain('Could not read');
			expect(process.exitCode).toBe(1);
		}
	});

	it('shows what a sync would do, syncs, and then reports it current', async () => {
		expect(await skills('status')).toContain(`missing   ${ID}  ${target}`);
		await expect(readdir(path.dirname(target))).rejects.toThrow();
		expect(await skills('sync')).toContain(`installed ${ID}`);
		expect(await readFile(path.join(target, 'SKILL.md'), 'utf8')).toBe('skill v1\n');
		expect(await skills('status')).toContain(`current   ${ID}`);
		const json = JSON.parse(await skills('status', '--json'));
		expect(json.schema).toBe('wheelhouse-skills-status.v1');
		expect(json.result.items[0]).toMatchObject({ id: ID, state: 'current' });
		// The skills' Firstmate contracts, and fm-brief.sh appending the brief include.
		expect(json.manifest.firstmate.assumptions).toHaveLength(4);
	});

	it('diffs an edited copy against what Wheelhouse wrote and this version, then accepts or keeps it', async () => {
		await skills('sync');
		await writeFile(path.join(target, 'SKILL.md'), 'skill v1\nmy note\n');
		await writeFile(path.join(source, 'SKILL.md'), 'skill v2\n');
		expect(await skills('sync')).toContain(`modified  ${ID}`);
		const d = await skills('diff', ID);
		expect(d).toContain('# Edits since Wheelhouse wrote');
		expect(d).toContain('+my note');
		expect(d).toContain('# What this version of Wheelhouse changes');
		expect(d).toContain('-skill v1');
		expect(d).toContain('+skill v2');

		await skills('keep', ID);
		expect(out.join('\n')).toContain('Keeping');
		expect(await skills('status')).toContain(`kept      ${ID}`);
		await writeFile(path.join(source, 'SKILL.md'), 'skill v3\n');
		expect(await skills('status')).toContain(`modified  ${ID}`);

		answer = false;
		await skills('accept', ID);
		expect(asked.at(-1)).toContain('Replace your edited');
		expect(await readFile(path.join(target, 'SKILL.md'), 'utf8')).toBe('skill v1\nmy note\n');
		await skills('accept', ID, '--yes');
		expect(out.join('\n')).toContain('the copy that was there is in');
		expect(await readFile(path.join(target, 'SKILL.md'), 'utf8')).toBe('skill v3\n');
		const backups = path.join(materialDir(env.WHEELHOUSE_CONFIG_DIR!), 'backup');
		const [item] = await readdir(backups);
		const [stamp] = await readdir(path.join(backups, item));
		expect(await readFile(path.join(backups, item, stamp, 'SKILL.md'), 'utf8')).toBe(
			'skill v1\nmy note\n'
		);
		expect(await skills('status')).toContain(`current   ${ID}`);
	});

	it('adopts a copy Wheelhouse did not install, only when asked', async () => {
		await mkdir(target, { recursive: true });
		await writeFile(path.join(target, 'SKILL.md'), 'hand-made\n');
		expect(await skills('sync')).toContain(`foreign   ${ID}`);
		await skills('accept', ID, '--yes');
		expect(err.join('\n')).toContain('not locally edited');
		await skills('adopt', ID, '--yes');
		expect(await readFile(path.join(target, 'SKILL.md'), 'utf8')).toBe('skill v1\n');
		expect((await readManifest(materialDir(env.WHEELHOUSE_CONFIG_DIR!)))!.items[ID]).toBeDefined();
	});

	it('uninstalls what it wrote, stops reinstalling it, and turns it on again by name', async () => {
		await skills('sync');
		await skills('uninstall', '--yes');
		expect(out.join('\n')).toContain(`Removed ${target}`);
		await expect(readdir(target)).rejects.toThrow();
		expect(await skills('sync')).toContain(`off       ${ID}`);
		await expect(readdir(target)).rejects.toThrow();
		expect(await skills('sync', ID)).toContain(`installed ${ID}`);
	});

	it('leaves an edited copy on uninstall', async () => {
		await skills('sync');
		await writeFile(path.join(target, 'SKILL.md'), 'mine\n');
		await skills('uninstall', ID, '--yes');
		expect(out.join('\n')).toContain('it was locally edited');
		expect(await readFile(path.join(target, 'SKILL.md'), 'utf8')).toBe('mine\n');
	});

	describe('the worker block in the home’s brief include', () => {
		const BLOCK = 'block:wheelhouse@brief-include';
		const brief = () => path.join(root, 'firstmate/config/brief-include.md');
		const text = () => readFile(brief(), 'utf8');

		it('is written beside the captain’s own text, removed alone, and put back by name', async () => {
			await mkdir(path.dirname(brief()), { recursive: true });
			await writeFile(brief(), 'Captain’s rule.\n');
			expect(await skills('sync')).toContain(`installed ${BLOCK}`);
			expect(await text()).toMatch(/^Captain’s rule\.\n\n<!-- wheelhouse:begin v=\S+ /);
			expect(await text()).toContain('## Wheelhouse');
			await skills('uninstall', BLOCK, '--yes');
			expect(out.join('\n')).toContain(`Removed Wheelhouse's block from ${brief()}`);
			expect(await text()).toBe('Captain’s rule.\n');
			expect(await skills('sync')).toContain(`off       ${BLOCK}`);
			expect(await text()).toBe('Captain’s rule.\n');
			expect(await skills('sync', BLOCK)).toContain(`installed ${BLOCK}`);
			expect(await text()).toContain('## Wheelhouse');
		});

		it('leaves an edited block, diffs it, and accepts this version on the captain’s say', async () => {
			await skills('sync');
			await writeFile(brief(), (await text()).replace('## Wheelhouse', '## Wheelhouse (mine)'));
			expect(await skills('status')).toContain(`modified  ${BLOCK}`);
			await skills('uninstall', BLOCK, '--yes');
			expect(out.join('\n')).toContain('its Wheelhouse block was edited');
			expect(await text()).toContain('(mine)');
			const diff = await skills('diff', BLOCK);
			expect(diff).toContain('-## Wheelhouse\n+## Wheelhouse (mine)');
			await skills('keep', BLOCK);
			expect(await skills('status')).toContain(`kept      ${BLOCK}`);
			await skills('accept', BLOCK, '--yes');
			expect(err.join('\n')).toContain('not locally edited');
		});
	});

	it('names an unknown item', async () => {
		await skills('diff', 'skill:nope@claude');
		expect(err.join('\n')).toContain('No such item: skill:nope@claude');
		expect(process.exitCode).toBe(1);
	});
});
