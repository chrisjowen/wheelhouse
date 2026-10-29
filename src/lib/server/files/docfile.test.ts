import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DOC_BYTES, readAsset, readDoc, usableRoots, type FileRoots } from './docfile';

let tmp: string;
let home: string;
let worktree: string;
let outside: string;
let roots: FileRoots;

beforeAll(async () => {
	tmp = await realpath(await mkdtemp(path.join(os.tmpdir(), 'wh-docfile-')));
	// The home has a space in it, like a real Firstmate home can.
	home = path.join(tmp, 'spikes ', 'firstmate');
	worktree = path.join(tmp, 'pool', 'wt-1');
	outside = path.join(tmp, 'elsewhere');
	for (const d of [path.join(home, 'data', 'wh-x'), worktree, outside]) {
		await mkdir(d, { recursive: true });
	}
	await writeFile(path.join(home, 'data', 'wh-x', 'report.md'), '# Gateway design\n\nThe plan.\n');
	await writeFile(path.join(home, 'data', 'wh-x', 'shot.png'), Buffer.from([0x89, 0x50]));
	await writeFile(path.join(home, 'data', 'wh-x', 'run.sh'), 'echo hi\n');
	for (const name of ['notes.txt', 'run.log', 'config.json', 'config.yaml', 'rows.csv']) {
		await writeFile(path.join(home, 'data', 'wh-x', name), 'x\n');
	}
	await writeFile(path.join(home, 'data', 'big.md'), `# Big\n${'x'.repeat(DOC_BYTES + 10)}`);
	await writeFile(path.join(worktree, 'NOTES.md'), 'Worktree notes\n');
	await writeFile(path.join(outside, 'secret.md'), '# Secret\n');
	await writeFile(path.join(outside, 'secret.txt'), 'secret\n');
	await writeFile(path.join(outside, 'secret.png'), Buffer.from([0x89, 0x50]));
	await symlink(path.join(outside, 'secret.md'), path.join(home, 'data', 'escape.md'));
	await symlink(outside, path.join(home, 'data', 'linked-dir'));
	await symlink(path.join(outside, 'secret.txt'), path.join(home, 'data', 'renamed.md'));
	await symlink(path.join(worktree, 'NOTES.md'), path.join(home, 'data', 'to-worktree.md'));
	roots = { home, roots: [home, worktree] };
});

afterAll(async () => {
	await rm(tmp, { recursive: true, force: true });
});

describe('readDoc', () => {
	it('reads a relative path against the Firstmate home', async () => {
		const r = await readDoc('data/wh-x/report.md', roots);
		expect(r).toMatchObject({
			ok: true,
			doc: {
				path: path.join(home, 'data', 'wh-x', 'report.md'),
				shown: 'data/wh-x/report.md',
				title: 'Gateway design',
				markdown: '# Gateway design\n\nThe plan.\n',
				truncated: false
			}
		});
	});

	it('reads an absolute path inside an allowed folder', async () => {
		const r = await readDoc(path.join(worktree, 'NOTES.md'), roots);
		expect(r).toMatchObject({ ok: true, doc: { shown: path.join(worktree, 'NOTES.md') } });
		// A symlink from one allowed folder into another is fine.
		expect((await readDoc('data/to-worktree.md', roots)).ok).toBe(true);
	});

	it('refuses paths outside the allowed folders, however they are written', async () => {
		for (const p of [
			path.join(outside, 'secret.md'),
			'../../elsewhere/secret.md',
			'data/../../../elsewhere/secret.md',
			`${home}/../../elsewhere/secret.md`,
			'/etc/hosts.md'
		]) {
			expect(await readDoc(p, roots), p).toMatchObject({ ok: false, status: 403 });
		}
	});

	it('refuses symlinks that lead out', async () => {
		expect(await readDoc('data/escape.md', roots)).toMatchObject({ ok: false, status: 403 });
		expect(await readDoc('data/linked-dir/secret.md', roots)).toMatchObject({
			ok: false,
			status: 403
		});
		// A Markdown name pointing at another kind of file is refused even inside.
		expect(await readDoc('data/renamed.md', roots)).toMatchObject({ ok: false });
	});

	it('refuses other kinds of file, missing files and folders', async () => {
		expect(await readDoc('data/wh-x/run.sh', roots)).toMatchObject({ ok: false, status: 415 });
		expect(await readDoc('data/wh-x/none.md', roots)).toMatchObject({ ok: false, status: 404 });
		await mkdir(path.join(home, 'data', 'folder.md'), { recursive: true });
		expect(await readDoc('data/folder.md', roots)).toMatchObject({ ok: false, status: 404 });
		expect(await readDoc('', roots)).toMatchObject({ ok: false, status: 400 });
		expect(await readDoc('data/a\0.md', roots)).toMatchObject({ ok: false, status: 400 });
	});

	it('reads only the start of a long document', async () => {
		const r = await readDoc('data/big.md', roots);
		expect(r.ok && r.doc.truncated).toBe(true);
		expect(r.ok && r.doc.markdown.length).toBe(DOC_BYTES);
	});
});

describe('readAsset', () => {
	it('serves images a document links to, inside the allowed folders', async () => {
		const img = await readAsset(path.join(home, 'data', 'wh-x', 'shot.png'), roots);
		expect(img).toMatchObject({ ok: true, type: 'image/png' });
		expect(await readAsset(path.join(outside, 'secret.png'), roots)).toMatchObject({
			ok: false,
			status: 403
		});
		expect(await readAsset('data/linked-dir/secret.png', roots)).toMatchObject({
			ok: false,
			status: 403
		});
	});

	it('serves no other kind of file, Markdown and plain text included', async () => {
		for (const name of [
			'run.sh',
			'report.md',
			'notes.txt',
			'run.log',
			'config.json',
			'config.yaml',
			'rows.csv'
		]) {
			expect(await readAsset(`data/wh-x/${name}`, roots), name).toMatchObject({
				ok: false,
				status: 415
			});
		}
		expect(await readAsset(path.join(outside, 'secret.txt'), roots)).toMatchObject({
			ok: false,
			status: 415
		});
	});
});

describe('usableRoots', () => {
	it('drops the filesystem root, the user’s home and its parents, and relative paths', () => {
		expect(
			usableRoots(
				['/', '/Users', '/Users/me', '/Users/me/fm', 'rel/dir', null, '/srv/repo/', '/srv/repo'],
				'/Users/me'
			)
		).toEqual(['/Users/me/fm', '/srv/repo']);
	});
});
