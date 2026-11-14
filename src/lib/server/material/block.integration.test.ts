import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { renderBlock } from './block';
import { emptyManifest, materialDir, type Manifest } from './manifest';
import { syncBlock, type BlockSpec, type MaterialContext } from './sync';

// A real git repository stands in for Firstmate's checkout, whose `git check-ignore` decides.
describe('syncing a block', () => {
	let root: string;
	let ctx: MaterialContext;
	let m: Manifest;
	let dir: string;
	let spec: BlockSpec;
	beforeEach(async () => {
		root = await mkdtemp(path.join(tmpdir(), 'wh-block-test-'));
		ctx = {
			install: {
				firstmateDir: path.join(root, 'firstmate'),
				homeDir: path.join(root, 'firstmate')
			},
			env: { HOME: path.join(root, 'user') },
			configDir: path.join(root, 'config'),
			skillsRoot: path.join(root, 'skills'),
			version: '1.0.0'
		};
		dir = materialDir(ctx.configDir);
		m = emptyManifest('1.0.0', 'claude');
		await mkdir(path.join(root, 'firstmate/config'), { recursive: true });
		execFileSync('git', ['init', '-q', path.join(root, 'firstmate')]);
		spec = {
			id: 'block:wheelhouse@brief-include',
			name: 'wheelhouse',
			target: path.join(root, 'firstmate/config/brief-include.md'),
			body: 'rule one'
		};
	});
	afterEach(async () => {
		await rm(root, { recursive: true, force: true });
	});
	const text = () => readFile(spec.target, 'utf8');

	it('refuses a file git would see in Firstmate’s checkout: it would stop Firstmate’s own updates', async () => {
		const r = await syncBlock(ctx, dir, m, spec);
		expect(r.state).toBe('refused');
		expect(r.message).toContain('git does not ignore it');
		await expect(text()).rejects.toThrow();
	});

	it('writes, updates and leaves an edited block, keeping the owner’s text around it', async () => {
		await writeFile(path.join(root, 'firstmate/.gitignore'), 'config/\n');
		await writeFile(spec.target, 'Captain’s own rule.\n', { mode: 0o640 });
		expect((await syncBlock(ctx, dir, m, spec)).state).toBe('installed');
		expect(await text()).toBe(
			`Captain’s own rule.\n\n${renderBlock('wheelhouse', '1.0.0', 'rule one')}\n`
		);
		expect((await stat(spec.target)).mode & 0o777).toBe(0o640);
		expect((await syncBlock(ctx, dir, m, spec)).state).toBe('current');

		ctx.version = '2.0.0';
		spec.body = 'rule two';
		expect((await syncBlock(ctx, dir, m, spec)).state).toBe('updated');
		expect(await text()).toBe(
			`Captain’s own rule.\n\n${renderBlock('wheelhouse', '2.0.0', 'rule two')}\n`
		);

		await writeFile(spec.target, (await text()).replace('rule two', 'my tweak'));
		spec.body = 'rule three';
		expect((await syncBlock(ctx, dir, m, spec)).state).toBe('modified');
		expect(await text()).toContain('my tweak');
		expect(
			await readFile(
				path.join(dir, 'proposed', 'block_wheelhouse@brief-include', 'block.md'),
				'utf8'
			)
		).toBe('rule three');
	});

	it('never rewrites a file whose markers are broken, and does not claim a block it did not write', async () => {
		await writeFile(path.join(root, 'firstmate/.gitignore'), 'config/\n');
		await writeFile(spec.target, 'mine\n<!-- wheelhouse:begin v=0 -->\nhalf\n');
		const r = await syncBlock(ctx, dir, m, spec);
		expect(r.state).toBe('modified');
		expect(r.message).toContain('missing its begin or end marker');
		expect(await text()).toBe('mine\n<!-- wheelhouse:begin v=0 -->\nhalf\n');
		await writeFile(spec.target, `${renderBlock('wheelhouse', '0', 'someone else')}\n`);
		expect((await syncBlock(ctx, dir, m, spec)).state).toBe('foreign');
	});

	it('writes outside Firstmate’s checkout without asking git', async () => {
		spec.target = path.join(root, 'elsewhere/notes.md');
		await mkdir(path.dirname(spec.target));
		expect((await syncBlock(ctx, dir, m, spec)).state).toBe('installed');
		expect(m.items[spec.id].kind).toBe('managed-block');
	});
});
