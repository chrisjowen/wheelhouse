import { execFileSync } from 'node:child_process';
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EvidenceReader, WORKTREE_GONE } from './evidence';
import { RemoteGit, remoteCommand, safeWorktree, shQuote, sshArgs } from './remotegit';

/**
 * A fake ssh: it logs its arguments, exits 255 when told the host is down, and
 * otherwise runs the command line it was given through `sh -c`, as the remote
 * login shell would, so the quoting is exercised for real.
 */
const FAKE_SSH = `#!/bin/sh
D="$(dirname "$0")"
for a in "$@"; do printf '[%s]' "$a" >> "$D/ssh.log"; done
echo >> "$D/ssh.log"
[ -f "$D/down" ] && { echo "ssh: connect to host: Connection refused" >&2; exit 255; }
while [ "$#" -gt 0 ] && [ "$1" != -- ]; do shift; done
shift; shift
cd "$D" || exit 1
exec sh -c "$1"
`;

let dir: string;
let bin: string;
let wt: string;
let canary: string;

const g = (cwd: string, ...a: string[]) =>
	execFileSync('git', a, {
		cwd,
		env: {
			...process.env,
			GIT_AUTHOR_NAME: 't',
			GIT_AUTHOR_EMAIL: 't@t',
			GIT_COMMITTER_NAME: 't',
			GIT_COMMITTER_EMAIL: 't@t'
		}
	}).toString();

beforeEach(() => {
	dir = mkdtempSync(path.join(tmpdir(), 'wh-remotegit-'));
	bin = path.join(dir, 'bin');
	mkdirSync(bin);
	writeFileSync(path.join(bin, 'ssh'), FAKE_SSH, { mode: 0o755 });
	// Were the path ever run, `touch pwned` would leave this file beside the fake ssh.
	canary = path.join(bin, 'pwned');
	// A worktree whose path a careless shell would split or run: a space, a quote, $(...).
	wt = path.join(dir, "work tree's $(touch pwned)");
	mkdirSync(wt);
	g(wt, 'init', '-q', '-b', 'main');
	writeFileSync(path.join(wt, 'app.ts'), 'export const a = 1;\n');
	writeFileSync(path.join(wt, 'old.txt'), 'one\ntwo\nthree\n');
	g(wt, 'add', '.');
	g(wt, 'commit', '-q', '-m', 'base');
	g(wt, 'checkout', '-q', '-b', 'fm/tk-1');
	writeFileSync(path.join(wt, 'app.ts'), 'export const a = 2;\nexport const b = 3;\n');
	g(wt, 'mv', 'old.txt', 'new.txt');
	g(wt, 'commit', '-q', '-am', 'feature');
	// Uncommitted and untracked work, as a worker leaves it mid-task.
	writeFileSync(path.join(wt, 'new.txt'), 'one\ntwo\nthree\nfour\n');
	writeFileSync(path.join(wt, 'my notes.md'), 'scratch\n');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const remote = () => new RemoteGit({ ssh: path.join(bin, 'ssh'), env: process.env });
const local = () =>
	new EvidenceReader({ dataDir: dir, useGh: false, evidenceDir: null, logsDir: null });
const sshCalls = () =>
	existsSync(path.join(bin, 'ssh.log'))
		? readFileSync(path.join(bin, 'ssh.log'), 'utf8').trim().split('\n')
		: [];

describe('a remote second mate’s task worktree, read over ssh', () => {
	it('lists the same changes the local read gives, uncommitted and untracked included', async () => {
		const r = await remote().changes('tokyo-box', wt, 'tokyo');
		const here = await local().diff(wt);
		expect(r.offline).toBe(false);
		expect(here.available && r.files.available).toBe(true);
		if (!here.available || !r.files.available) return;
		expect(r.files.value).toEqual(here.value);
		expect(r.files.value.files.map((f) => [f.path, f.status])).toEqual([
			['app.ts', 'M'],
			['new.txt', 'R'],
			['my notes.md', '?']
		]);
		expect(r.files.value.branch).toBe('fm/tk-1');
		expect(r.files.source).toBe(
			'git diff against main in the task worktree on second mate tokyo, including uncommitted and untracked files'
		);
		// The path was passed as data: nothing in it ran.
		expect(existsSync(canary)).toBe(false);
	});

	it('shows a tracked, a renamed and an untracked file’s diff as the local read does', async () => {
		const r = await remote().changes('tokyo-box', wt, 'tokyo');
		if (!r.files.available) throw new Error(r.files.reason);
		const { base, mergeBase, files } = r.files.value;
		for (const entry of files) {
			const there = await remote().fileDiff('tokyo-box', wt, 'tokyo', mergeBase, base, entry);
			const here = await local().fileDiff(wt, entry.path);
			expect(there.diff.available).toBe(true);
			if (!there.diff.available || !here.available) continue;
			expect(there.diff.value).toEqual(here.value);
		}
		const notes = files.find((f) => f.path === 'my notes.md')!;
		const d = await remote().fileDiff('tokyo-box', wt, 'tokyo', mergeBase, base, notes);
		expect(d.diff).toMatchObject({
			available: true,
			source: 'the new, uncommitted file in the task worktree on second mate tokyo',
			value: { lines: ['@@ -0,0 +1 @@', '+scratch'] }
		});
		expect(existsSync(canary)).toBe(false);
	});

	it('only reads: no fetch, and the index is not rewritten', async () => {
		const index = path.join(wt, '.git', 'index');
		// git status itself refreshes the index, so it runs before the index is timed.
		const status = g(wt, 'status', '--porcelain');
		const before = statSync(index).mtimeMs;
		const r = await remote().changes('tokyo-box', wt, 'tokyo');
		if (!r.files.available) throw new Error(r.files.reason);
		const { base, mergeBase, files } = r.files.value;
		for (const entry of files) {
			await remote().fileDiff('tokyo-box', wt, 'tokyo', mergeBase, base, entry);
		}
		expect(statSync(index).mtimeMs).toBe(before);
		expect(existsSync(path.join(wt, '.git', 'FETCH_HEAD'))).toBe(false);
		expect(g(wt, 'status', '--porcelain')).toBe(status);
	});

	it('goes over the alias with fm-on.sh’s ssh options and one fixed sh script', async () => {
		await remote().changes('tokyo-box', wt, 'tokyo');
		const [call] = sshCalls();
		for (const opt of [
			'BatchMode=yes',
			'ForwardAgent=no',
			'ClearAllForwardings=yes',
			'SendEnv=-*',
			'ServerAliveInterval=15'
		]) {
			expect(call).toContain(`[${opt}]`);
		}
		expect(call).toContain('[--][tokyo-box][');
	});

	it('says offline when ssh cannot reach the host (exit 255)', async () => {
		writeFileSync(path.join(bin, 'down'), '');
		const r = await remote().changes('tokyo-box', wt, 'tokyo');
		expect(r).toEqual({
			files: {
				available: false,
				reason:
					'Offline: Wheelhouse could not reach tokyo-box. Wheelhouse does not try again by itself.'
			},
			offline: true
		});
		const d = await remote().fileDiff('tokyo-box', wt, 'tokyo', 'a'.repeat(40), 'main', {
			path: 'app.ts',
			status: 'M',
			additions: 1,
			deletions: 1
		});
		expect(d.offline).toBe(true);
	});

	it('says the worktree is gone once it is', async () => {
		const r = await remote().changes('tokyo-box', path.join(dir, 'nope'), 'tokyo');
		expect(r.files).toEqual({ available: false, reason: WORKTREE_GONE });
	});

	it('says when a directory is not a worktree with a base branch', async () => {
		const plain = path.join(dir, 'plain');
		mkdirSync(plain);
		const r = await remote().changes('tokyo-box', plain, 'tokyo');
		expect(r.files).toMatchObject({
			available: false,
			reason: expect.stringMatching(/base branch/)
		});
	});

	it('refuses an unsafe worktree path or host without running ssh', async () => {
		for (const bad of ['relative/wt', '/a/../etc', '/a//b', '/a/./b', '/a/b\nc', '']) {
			expect((await remote().changes('tokyo-box', bad, 'tokyo')).files.available).toBe(false);
		}
		for (const host of ['-oProxyCommand=x', 'a b', '']) {
			expect((await remote().changes(host, wt, 'tokyo')).files.available).toBe(false);
		}
		const d = await remote().fileDiff('tokyo-box', wt, 'tokyo', 'HEAD; rm -rf /', 'main', {
			path: 'app.ts',
			status: 'M',
			additions: 1,
			deletions: 1
		});
		expect(d.diff.available).toBe(false);
		expect(sshCalls()).toEqual([]);
	});
});

describe('the remote command line', () => {
	it('quotes every word for a POSIX shell, quotes included', () => {
		expect(shQuote("it's")).toBe(`'it'\\''s'`);
		const line = remoteCommand('echo "$1"', ["a b'c $(x)"]);
		expect(execFileSync('sh', ['-c', line]).toString()).toBe("a b'c $(x)\n");
	});

	it('puts -- before the host so a host can never be an option', () => {
		const args = sshArgs('tokyo-box', 'cmd');
		expect(args.slice(-3)).toEqual(['--', 'tokyo-box', 'cmd']);
	});

	it('takes only absolute, plain worktree paths', () => {
		expect(safeWorktree('/home/fm/tokyo/wt/tk-1')).toBe(true);
		expect(safeWorktree("/home/fm/it's here/")).toBe(true);
		for (const bad of ['wt', '/a/../b', '/a/./b', '/a//b', '/a\tb', '/' + 'a'.repeat(5000)]) {
			expect(safeWorktree(bad)).toBe(false);
		}
	});
});
