import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { defaultDeps, runCheck, type CheckContext, type CheckDeps } from './checks';
import { runBounded, type RunOptions } from '../firstmate/exec';
import type { CheckSpec } from './schema';

const MERGE = 'a'.repeat(40);
const HEAD = 'b'.repeat(40);

const ctx = (o: Partial<CheckContext> = {}): CheckContext => ({
	taskId: 'fix-login',
	refs: { mergeCommit: MERGE, prHead: HEAD },
	repo: 'acme/web',
	clone: null,
	firstmateRoot: '/fm',
	releaseTag: null,
	...o
});

describe('git.contains', () => {
	const dir = mkdtempSync(path.join(tmpdir(), 'wh-git-'));
	const git = (...a: string[]) =>
		execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8' }).trim();
	git('init', '-q', '-b', 'main');
	git('config', 'user.email', 't@example.com');
	git('config', 'user.name', 'T');
	writeFileSync(path.join(dir, 'a'), '1');
	git('add', 'a');
	git('commit', '-qm', 'one');
	const first = git('rev-parse', 'HEAD');
	git('checkout', '-qb', 'side');
	writeFileSync(path.join(dir, 'b'), '2');
	git('add', 'b');
	git('commit', '-qm', 'two');
	const second = git('rev-parse', 'HEAD');
	git('checkout', '-q', 'main');
	afterAll(() => rmSync(dir, { recursive: true, force: true }));

	const spec: CheckSpec = { type: 'git.contains', repo: 'firstmate-root', commit: 'merge.commit' };
	const real = defaultDeps({ PATH: process.env.PATH, HOME: process.env.HOME });
	const at = (sha: string, o: Partial<CheckSpec> = {}) =>
		runCheck(
			{ ...spec, ...o } as CheckSpec,
			ctx({ firstmateRoot: dir, refs: { mergeCommit: sha, prHead: null } }),
			real
		);

	it('answers yes when the ref contains the commit, and no when it does not', async () => {
		expect(await at(first)).toMatchObject({ outcome: 'yes', terminal: true });
		expect(await at(second)).toMatchObject({ outcome: 'no', terminal: false });
		expect(await at(second, { ref: 'side' })).toMatchObject({ outcome: 'yes' });
	});

	it('answers no for a commit this checkout has not fetched yet', async () => {
		expect((await at('d'.repeat(40))).outcome).toBe('no');
	});

	it('is unknown for a missing ref or a missing clone', async () => {
		expect((await at(first, { ref: 'nope' })).outcome).toBeNull();
		const r = await runCheck({ ...spec, repo: 'project-clone' }, ctx({ clone: null }), real);
		expect(r.summary).toBe('This project has no Firstmate clone.');
	});
});

describe('command checks run on a pinned checkout', () => {
	const dir = mkdtempSync(path.join(tmpdir(), 'wh-cmd-'));
	const git = (...a: string[]) =>
		execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8' }).trim();
	git('init', '-q', '-b', 'main');
	git('config', 'user.email', 't@example.com');
	git('config', 'user.name', 'T');
	writeFileSync(path.join(dir, 'a'), 'main tip\n');
	git('add', 'a');
	git('commit', '-qm', 'one');
	const tip = git('rev-parse', 'HEAD');
	git('checkout', '-qb', 'task');
	writeFileSync(path.join(dir, 'a'), 'merged work\n');
	git('commit', '-qam', 'two');
	const merged = git('rev-parse', 'HEAD');
	git('checkout', '-q', 'main');
	writeFileSync(path.join(dir, 'a'), 'uncommitted in the clone\n');
	afterAll(() => rmSync(dir, { recursive: true, force: true }));

	const seen: RunOptions[] = [];
	const real: CheckDeps = {
		...defaultDeps({ PATH: process.env.PATH, HOME: process.env.HOME }),
		run: (file: string, args: readonly string[], opts: RunOptions) => {
			seen.push(opts);
			return runBounded(file, args, opts);
		}
	};
	const at = (o: Partial<CheckSpec>, mergeCommit: string | null = merged) =>
		runCheck(
			{ type: 'command', run: ['/bin/cat', 'a'], ...o } as CheckSpec,
			ctx({
				projectId: 'web',
				checkId: 'local',
				refs: { mergeCommit, prHead: null },
				clone: { dir, defaultRef: 'main' }
			}),
			real
		);
	const worktrees = () => git('worktree', 'list', '--porcelain').split('\n\n').length;

	it('runs on the merge commit, not the clone’s working tree, and removes the checkout', async () => {
		seen.length = 0;
		const r = await at({ ref: 'merge.commit' });
		expect(r).toMatchObject({ outcome: 'passed', output: 'merged work\n' });
		expect(seen[0].env?.WHEELHOUSE_COMMIT).toBe(merged);
		expect(seen[0].cwd).not.toBe(dir);
		expect(existsSync(seen[0].cwd!)).toBe(false);
		expect(worktrees()).toBe(1);
	});

	it('runs on the default branch’s tip without a ref', async () => {
		seen.length = 0;
		const r = await at({});
		expect(r).toMatchObject({ outcome: 'passed', output: 'main tip\n' });
		expect(seen[0].env?.WHEELHOUSE_COMMIT).toBe(tip);
	});

	it('removes the checkout after a failure too', async () => {
		seen.length = 0;
		const r = await at({ run: ['/bin/cat', 'missing'] });
		expect(r.outcome).toBe('failed');
		expect(existsSync(seen[0].cwd!)).toBe(false);
		expect(worktrees()).toBe(1);
	});

	const blocked = () => {
		let release = () => {};
		const gate = new Promise<void>((r) => (release = r));
		const started: RunOptions[] = [];
		let ready = () => {};
		const running = new Promise<void>((r) => (ready = r));
		const d: CheckDeps = {
			...real,
			run: async (file, args, opts) => {
				started.push(opts);
				ready();
				await gate;
				return runBounded(file, args, opts);
			}
		};
		return { d, release, running, started };
	};
	const live = (d: CheckDeps, purpose: 'test' | 'live' = 'live') =>
		runCheck(
			{ type: 'command', run: ['/bin/cat', 'a'], ref: 'merge.commit' },
			ctx({
				projectId: 'web',
				checkId: 'local',
				purpose,
				refs: { mergeCommit: merged, prHead: null },
				clone: { dir, defaultRef: 'main' }
			}),
			d
		);

	it('gives a test and the task’s own run of the same check their own checkouts', async () => {
		const b = blocked();
		const first = live(b.d, 'live');
		await b.running;
		seen.length = 0;
		const test = await live(real, 'test');
		expect(test).toMatchObject({ outcome: 'passed', output: 'merged work\n' });
		expect(seen[0].cwd).not.toBe(b.started[0].cwd);
		expect(existsSync(b.started[0].cwd!)).toBe(true);
		b.release();
		expect(await first).toMatchObject({ outcome: 'passed', output: 'merged work\n' });
		expect(existsSync(b.started[0].cwd!)).toBe(false);
		expect(worktrees()).toBe(1);
	});

	it('refuses a second run of a checkout in use, and leaves that checkout alone', async () => {
		const b = blocked();
		const first = live(b.d);
		await b.running;
		const second = await live(real);
		expect(second).toMatchObject({
			outcome: null,
			summary: 'The same check is already running on this commit; it was not started again.'
		});
		expect(existsSync(path.join(b.started[0].cwd!, 'a'))).toBe(true);
		b.release();
		expect(await first).toMatchObject({ outcome: 'passed', output: 'merged work\n' });
		expect(worktrees()).toBe(1);
	});

	const leftover = path.join(tmpdir(), `wheelhouse-live-web-fix-login-local-${merged}`);

	it('removes a checkout left over from an earlier run before the next run', async () => {
		git('worktree', 'add', '-q', '--detach', leftover, merged);
		mkdirSync(path.join(leftover, 'node_modules', 'pkg'), { recursive: true });
		writeFileSync(path.join(leftover, 'node_modules', 'pkg', 'index.js'), 'x');
		writeFileSync(path.join(leftover, 'a'), 'stale edit\n');
		const r = await at({ ref: 'merge.commit' });
		expect(r).toMatchObject({ outcome: 'passed', output: 'merged work\n' });
		expect(existsSync(leftover)).toBe(false);
		expect(worktrees()).toBe(1);
	});

	it('has no outcome when a leftover checkout cannot be removed', async () => {
		mkdirSync(leftover, { recursive: true });
		writeFileSync(path.join(leftover, 'a'), 'not a checkout\n');
		seen.length = 0;
		try {
			const r = await at({ ref: 'merge.commit' });
			expect(r).toMatchObject({
				outcome: null,
				summary:
					'A checkout left over from an earlier run of this check could not be removed, so it was not started.'
			});
			expect(seen).toEqual([]);
		} finally {
			rmSync(leftover, { recursive: true, force: true });
		}
	});

	it('has no outcome when the commit cannot be checked out', async () => {
		seen.length = 0;
		const r = await at({ ref: 'merge.commit' }, 'd'.repeat(40));
		expect(r).toMatchObject({
			outcome: null,
			summary: 'The commit ddddddd could not be checked out from the project clone.'
		});
		expect(seen).toEqual([]);
		expect(worktrees()).toBe(1);
	});
});
