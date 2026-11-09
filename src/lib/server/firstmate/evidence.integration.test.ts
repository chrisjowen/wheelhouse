import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { diffBody, EvidenceReader, FILE_DIFF_MAX_LINES, WORKTREE_GONE } from './evidence';

let dir: string;
let data: string;
let nm: string;
const reader = () => new EvidenceReader({ dataDir: data, useGh: false, evidenceDir: nm });

beforeEach(() => {
	dir = mkdtempSync(path.join(tmpdir(), 'wh-evidence-'));
	data = path.join(dir, 'data');
	nm = path.join(dir, 'nm-evidence');
	mkdirSync(path.join(data, 't-1', 'screenshots'), { recursive: true });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('diff', () => {
	it('lists committed, uncommitted and untracked changes against the base branch', async () => {
		const repo = path.join(dir, 'repo');
		mkdirSync(repo);
		const git = (...a: string[]) => execFileSync('git', ['-C', repo, ...a], { stdio: 'pipe' });
		git('init', '-q', '-b', 'main');
		git('config', 'user.email', 't@t');
		git('config', 'user.name', 't');
		writeFileSync(path.join(repo, 'a.txt'), 'one\n');
		git('add', '.');
		git('commit', '-qm', 'base');
		git('checkout', '-qb', 'fm/t-1');
		writeFileSync(path.join(repo, 'a.txt'), 'one\ntwo\n');
		git('commit', '-qam', 'work');
		writeFileSync(path.join(repo, 'b.txt'), 'new\n');
		const d = await reader().diff(repo);
		expect(d.available).toBe(true);
		if (d.available) {
			expect(d.value.base).toBe('main');
			expect(d.value.branch).toBe('fm/t-1');
			expect(d.value.files).toEqual([
				{ path: 'a.txt', status: 'M', additions: 1, deletions: 0 },
				{ path: 'b.txt', status: '?', additions: null, deletions: null }
			]);
		}
	});

	it('is unavailable without a recorded worktree', async () => {
		expect(await reader().diff(null)).toMatchObject({ available: false });
	});
});

describe('file diff', () => {
	let repo: string;
	const git = (...a: string[]) => execFileSync('git', ['-C', repo, ...a], { stdio: 'pipe' });
	beforeEach(() => {
		repo = path.join(dir, 'repo');
		mkdirSync(repo);
		git('init', '-q', '-b', 'main');
		git('config', 'user.email', 't@t');
		git('config', 'user.name', 't');
		writeFileSync(path.join(repo, 'a.txt'), 'one\n');
		writeFileSync(path.join(repo, 'secret.txt'), 'not part of the change\n');
		git('add', '.');
		git('commit', '-qm', 'base');
		git('checkout', '-qb', 'fm/t-1');
	});

	it('shows one changed file’s hunks against the merge base, uncommitted edits included', async () => {
		writeFileSync(path.join(repo, 'a.txt'), 'one\ntwo\n');
		git('commit', '-qam', 'work');
		writeFileSync(path.join(repo, 'a.txt'), 'one\ntwo\nthree\n');
		const d = await reader().fileDiff(repo, 'a.txt');
		expect(d.available).toBe(true);
		if (d.available) {
			expect(d.value.base).toBe('main');
			expect(d.value.lines[0]).toMatch(/^@@ /);
			expect(d.value.lines.slice(1)).toEqual([' one', '+two', '+three']);
			expect(d.value.truncated).toBe(false);
		}
	});

	it('shows a renamed file’s real changes, not the whole file as new', async () => {
		const body = Array.from({ length: 20 }, (_, i) => `line ${i}`);
		writeFileSync(path.join(repo, 'a.txt'), `${body.join('\n')}\n`);
		git('commit', '-qam', 'longer');
		git('checkout', '-qb', 'fm/t-2');
		git('mv', 'a.txt', 'b.txt');
		body[5] = 'line five';
		writeFileSync(path.join(repo, 'b.txt'), `${body.join('\n')}\n`);
		git('commit', '-qam', 'rename');
		git('branch', '-qf', 'main', 'fm/t-1');
		const list = await reader().diff(repo);
		expect(list.available && list.value.files).toEqual([
			{ path: 'b.txt', oldPath: 'a.txt', status: 'R', additions: 1, deletions: 1 }
		]);
		const d = await reader().fileDiff(repo, 'b.txt');
		expect(d.available).toBe(true);
		if (d.available) {
			expect(d.value.lines.filter((l) => /^[+-]/.test(l))).toEqual(['-line 5', '+line five']);
		}
	});

	it('counts every changed file even when the list is cut short', async () => {
		for (let i = 0; i < 301; i++) writeFileSync(path.join(repo, `n${i}.txt`), 'x\n');
		const d = await reader().diff(repo);
		expect(d.available).toBe(true);
		if (d.available) {
			expect(d.value.files).toHaveLength(300);
			expect(d.value.total).toBe(301);
			expect(d.value.truncated).toBe(true);
		}
		expect(await reader().thumb('t-1', repo)).toMatchObject({ kind: 'diff', totalFiles: 301 });
	});

	it('shows a new, uncommitted file in full', async () => {
		writeFileSync(path.join(repo, 'b.txt'), 'new\n');
		const d = await reader().fileDiff(repo, 'b.txt');
		expect(d).toMatchObject({ available: true, value: { lines: ['@@ -0,0 +1 @@', '+new'] } });
	});

	it('refuses a path that is not in the changed-files list', async () => {
		writeFileSync(path.join(repo, 'a.txt'), 'changed\n');
		for (const bad of ['secret.txt', '../outside.txt', '/etc/passwd', '--output=/tmp/x']) {
			const d = await reader().fileDiff(repo, bad);
			expect(d).toEqual({
				available: false,
				reason: 'That file is not in this task’s list of changed files.'
			});
		}
	});

	it('bounds the lines it returns', async () => {
		const big = Array.from({ length: FILE_DIFF_MAX_LINES + 50 }, (_, i) => `line ${i}`).join('\n');
		writeFileSync(path.join(repo, 'a.txt'), `${big}\n`);
		const d = await reader().fileDiff(repo, 'a.txt');
		expect(d.available).toBe(true);
		if (d.available) {
			expect(d.value.lines).toHaveLength(FILE_DIFF_MAX_LINES);
			expect(d.value.truncated).toBe(true);
		}
	});

	it('says plainly when the diff is too large to read', async () => {
		writeFileSync(path.join(repo, 'a.txt'), `${'x'.repeat(200)}\n`.repeat(4000));
		const d = await reader().fileDiff(repo, 'a.txt');
		expect(d.available).toBe(false);
		if (!d.available) expect(d.reason).toMatch(/larger than 512 KB/);
	});

	it('says the diff is not available when the worktree is gone', async () => {
		expect(await reader().fileDiff(path.join(dir, 'gone'), 'a.txt')).toEqual({
			available: false,
			reason: WORKTREE_GONE
		});
		expect(await reader().fileDiff(null, 'a.txt')).toEqual({
			available: false,
			reason: WORKTREE_GONE
		});
	});

	it('diffBody keeps hunks and spots binary files', () => {
		expect(
			diffBody('diff --git a/x b/x\nindex 1..2 100644\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\n')
		).toEqual({ lines: ['@@ -1 +1 @@', '-a', '+b'], binary: false });
		expect(diffBody('diff --git a/i b/i\nBinary files a/i and b/i differ\n')).toEqual({
			lines: [],
			binary: true
		});
	});
});
