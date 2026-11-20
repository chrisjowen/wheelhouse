import { execFileSync } from 'node:child_process';
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EvidenceReader, WORKTREE_GONE } from './evidence';
import {
	parseTaskRead,
	RemoteGit,
	remoteCommand,
	safeWorktree,
	shQuote,
	sshArgs,
	type TaskReadWant
} from './remotegit';

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
					'Offline: could not reach tokyo-box (it refused the connection). Wheelhouse does not try again by itself.'
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

describe('a remote task’s home, read in one ssh call', () => {
	let home: string;
	const want = (o: Partial<TaskReadWant> = {}): TaskReadWant => ({
		statusMax: 1024,
		briefMax: 4096,
		metaMax: 1024,
		git: '',
		...o
	});
	beforeEach(() => {
		// A home whose path a careless shell would split or run, as the worktree's.
		home = path.join(dir, "fm home's $(touch pwned)");
		mkdirSync(path.join(home, 'state'), { recursive: true });
		mkdirSync(path.join(home, 'data', 'tk-1'), { recursive: true });
		writeFileSync(path.join(home, 'state', 'tk-1.status'), 'working [at=1793000000]: héllo\n');
		writeFileSync(path.join(home, 'state', 'tk-1.meta'), `project=/p/lumen\nworktree=${wt}\n`);
		writeFileSync(
			path.join(home, 'data', 'tk-1', 'brief.md'),
			'# Task\n## Captain’s intent\nship\n'
		);
	});

	it('sends its status log, meta, brief and the changes in the worktree its meta records', async () => {
		const r = await remote().taskRead('tokyo-box', home, 'tk-1', 'tokyo', want());
		// One ssh call (the script spans lines in the log; each call starts with its options).
		expect(sshCalls().join('\n').split('[-o][BatchMode=yes]')).toHaveLength(2);
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.value.status?.text).toBe('working [at=1793000000]: héllo\n');
		expect(r.value.meta?.text).toContain(`worktree=${wt}`);
		expect(r.value.brief?.text).toContain('ship');
		const here = await local().diff(wt);
		expect(r.value.git?.worktree).toBe(wt);
		expect(r.value.git?.files.available && here.available).toBe(true);
		if (r.value.git?.files.available && here.available) {
			expect(r.value.git.files.value).toEqual(here.value);
		}
		expect(existsSync(canary)).toBe(false);
	});

	it('sends a long status log’s end from its first whole line, and a long brief’s start', async () => {
		const line = 'working [at=1793000000]: ünïcode line\n';
		writeFileSync(path.join(home, 'state', 'tk-1.status'), line.repeat(100));
		writeFileSync(path.join(home, 'data', 'tk-1', 'brief.md'), 'b'.repeat(5000));
		const r = await remote().taskRead('tokyo-box', home, 'tk-1', 'tokyo', want());
		if (!r.ok) throw new Error(r.reason);
		const status = r.value.status!;
		expect(status.size).toBe(Buffer.byteLength(line) * 100);
		expect(status.sent).toBe(1024);
		expect(status.text.startsWith('working')).toBe(true);
		expect(
			status.text
				.split('\n')
				.filter(Boolean)
				.every((l) => l === line.trim())
		).toBe(true);
		expect(r.value.brief).toMatchObject({ size: 5000, sent: 4096 });
	});

	it('lists the worktree it is given, or none, and skips the brief when not asked', async () => {
		const none = await remote().taskRead(
			'tokyo-box',
			home,
			'tk-1',
			'tokyo',
			want({ git: false, briefMax: 0 })
		);
		expect(none.ok && none.value).toMatchObject({ brief: null, git: null });
		const given = await remote().taskRead(
			'tokyo-box',
			home,
			'tk-1',
			'tokyo',
			want({ git: path.join(dir, 'gone') })
		);
		expect(given.ok && given.value.git).toEqual({
			worktree: path.join(dir, 'gone'),
			files: { available: false, reason: WORKTREE_GONE }
		});
	});

	it('reads no file that is missing, a symlink, or outside the home', async () => {
		rmSync(path.join(home, 'state', 'tk-1.status'));
		rmSync(path.join(home, 'data', 'tk-1', 'brief.md'));
		const secret = path.join(dir, 'secret.txt');
		writeFileSync(secret, 'secret\n');
		symlinkSync(secret, path.join(home, 'data', 'tk-1', 'brief.md'));
		rmSync(path.join(home, 'state', 'tk-1.meta'));
		const out = path.join(dir, 'outside');
		mkdirSync(out);
		writeFileSync(path.join(out, 'tk-1.meta'), 'worktree=/etc\n');
		rmSync(path.join(home, 'state'), { recursive: true });
		symlinkSync(out, path.join(home, 'state'));
		const r = await remote().taskRead('tokyo-box', home, 'tk-1', 'tokyo', want());
		expect(r.ok && r.value).toEqual({ status: null, meta: null, brief: null, git: null });
	});

	it('says offline when its host cannot be reached, and when it cannot be read this way', async () => {
		const missing = await remote().taskRead(
			'tokyo-box',
			path.join(dir, 'nope'),
			'tk-1',
			'tokyo',
			want()
		);
		expect(missing).toMatchObject({ ok: false, offline: false, unsupported: true });
		writeFileSync(path.join(bin, 'down'), '');
		const down = await remote().taskRead('tokyo-box', home, 'tk-1', 'tokyo', want());
		expect(down).toMatchObject({ ok: false, offline: true, unsupported: false });
	});

	it('refuses an unsafe host, home, task or worktree without running ssh', async () => {
		const tries: [string, string, string, TaskReadWant][] = [
			['-oProxyCommand=x', home, 'tk-1', want()],
			['tokyo-box', 'relative', 'tk-1', want()],
			['tokyo-box', '/a/../b', 'tk-1', want()],
			['tokyo-box', home, '../tk-1', want()],
			['tokyo-box', home, 'tk-1', want({ git: 'relative/wt' })]
		];
		for (const [host, h, task, w] of tries) {
			expect((await remote().taskRead(host, h, task, 'tokyo', w)).ok).toBe(false);
		}
		expect(sshCalls()).toEqual([]);
	});

	it('takes nothing but a whole answer', () => {
		const max = { status: 10, brief: 10, meta: 10 };
		const good = 'status ok 2 2\nab' + 'meta none 0 0\n' + 'brief none 0 0\n' + 'git - 0\n';
		expect(parseTaskRead(Buffer.from(good), max, 'tokyo', 'x')).toMatchObject({
			status: { text: 'ab' }
		});
		for (const bad of [
			'',
			good.slice(0, -1),
			good + 'more',
			good.replace('ok 2 2', 'ok 2 20'),
			good.replace('ok 2 2', 'ok 99 11'),
			good.replace('git - 0', 'git 0 5 /wt\nab')
		]) {
			expect(parseTaskRead(Buffer.from(bad), max, 'tokyo', 'x')).toBeNull();
		}
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
