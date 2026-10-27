import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	answeredRoundFromLog,
	ciChecksFromLog,
	ciResultFromLog,
	fixCommitsFromLog,
	diffBody,
	EvidenceReader,
	excerpt,
	FILE_DIFF_MAX_LINES,
	fixRoundFromLog,
	githubPull,
	parseDiff,
	parsePrFeedback,
	PR_FEEDBACK_QUERY,
	WORKTREE_GONE
} from './evidence';
import { addressingReview } from './changes';

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

describe('screenshots', () => {
	it('lists the worker’s images first, then no-mistakes run evidence', async () => {
		writeFileSync(path.join(data, 't-1', 'screenshots', 'a.png'), 'x');
		writeFileSync(path.join(data, 't-1', 'shot-1.png'), 'x');
		writeFileSync(path.join(data, 't-1', 'notes.txt'), 'x');
		writeFileSync(path.join(data, 't-1', 'nm-01M4EVPEV7WZJSXGPV34AVXHB8-review-findings.txt'), 'x');
		mkdirSync(path.join(nm, '01M4EVPEV7WZJSXGPV34AVXHB8'), { recursive: true });
		writeFileSync(path.join(nm, '01M4EVPEV7WZJSXGPV34AVXHB8', 'r1-ui.png'), 'x');
		const names = (await reader().screenshots('t-1')).map((s) => s.name).sort();
		expect(names).toEqual([
			'nm/01M4EVPEV7WZJSXGPV34AVXHB8/r1-ui.png',
			'screenshots/a.png',
			'shot-1.png'
		]);
	});

	it('serves only listed screenshots, never arbitrary paths', async () => {
		writeFileSync(path.join(data, 't-1', 'screenshots', 'a.png'), 'x');
		writeFileSync(path.join(data, 'backlog.md'), 'secret');
		const r = reader();
		expect(await r.artifactFile('t-1', 'screenshots/a.png')).toBe(
			path.join(data, 't-1', 'screenshots', 'a.png')
		);
		for (const bad of [
			'../backlog.md',
			'../../etc/passwd',
			'screenshots/../../backlog.md',
			'/etc/passwd',
			'notes.txt'
		]) {
			expect(await r.artifactFile('t-1', bad)).toBeNull();
		}
		expect(await r.artifactFile('../data', 'backlog.md')).toBeNull();
	});
});

describe('pr', () => {
	it('reads Firstmate’s cached PR observation', async () => {
		const url = 'https://github.com/o/r/pull/33';
		writeFileSync(
			path.join(data, 't-1', 'contributions.json'),
			JSON.stringify({
				schema: 'fm-contributions.v1',
				records: [
					{
						url,
						kind: 'pr',
						checked_at: '2026-10-08T16:53:56Z',
						observation: {
							state: 'open',
							draft: false,
							review_decision: 'REVIEW_REQUIRED',
							checks: [
								{ name: 'check', status: 'completed', conclusion: 'success' },
								{ name: 'e2e', status: 'in_progress', conclusion: null }
							]
						}
					}
				]
			})
		);
		const pr = await reader().pr('t-1', url);
		expect(pr.available).toBe(true);
		if (pr.available) {
			expect(pr.value).toMatchObject({ number: 33, state: 'open', draft: false });
			expect(pr.value.checks).toEqual([
				{ name: 'check', state: 'pass' },
				{ name: 'e2e', state: 'running' }
			]);
			expect(pr.observedAt).toBe('2026-10-08T16:53:56Z');
		}
	});

	it('says why PR state is unavailable', async () => {
		expect(await reader().pr('t-1', null)).toMatchObject({ available: false });
		expect(await reader().pr('t-1', 'https://github.com/o/r/pull/1')).toMatchObject({
			available: false
		});
	});
});

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

it('parseDiff handles renames and binary files', () => {
	const files = parseDiff(
		'3\t1\tsrc/{old => new}.ts\n-\t-\timg.png\n',
		'R100\tsrc/old.ts\tsrc/new.ts\nA\timg.png\n'
	);
	expect(files).toEqual([
		{ path: 'src/new.ts', oldPath: 'src/old.ts', status: 'R', additions: 3, deletions: 1 },
		{ path: 'img.png', status: 'A', additions: null, deletions: null }
	]);
});

it('parseDiff keeps renames into a parent directory and into a subdirectory', () => {
	const files = parseDiff(
		'0\t0\tsrc/{sub => }/x.ts\n2\t1\tsrc/{ => sub}/y.ts\n',
		'R100\tsrc/sub/x.ts\tsrc/x.ts\nR090\tsrc/y.ts\tsrc/sub/y.ts\n'
	);
	expect(files).toEqual([
		{ path: 'src/x.ts', oldPath: 'src/sub/x.ts', status: 'R', additions: 0, deletions: 0 },
		{ path: 'src/sub/y.ts', oldPath: 'src/y.ts', status: 'R', additions: 2, deletions: 1 }
	]);
});

it('excerpt takes the first prose paragraph without Markdown', () => {
	expect(excerpt('# Title\n\n**Status:** it is `live` at [x](http://y).\n\nMore.')).toBe(
		'Status: it is live at x.'
	);
});

describe('CI monitor readiness', () => {
	const RUN = '01M4N30B7JVFV5989ZS2QEVZ7Q';

	it('reads the latest checks marker of a ci step log', () => {
		expect(ciChecksFromLog('all CI checks passed - still monitoring until merged or closed')).toBe(
			'green'
		);
		expect(ciChecksFromLog('no CI checks reported - still monitoring until merged or closed')).toBe(
			'green'
		);
		expect(ciChecksFromLog('CI checks running\nall CI checks passed - still monitoring')).toBe(
			'green'
		);
		expect(ciChecksFromLog('all CI checks passed - still monitoring\nchecks failed: lint')).toBe(
			'not-ready'
		);
		expect(ciChecksFromLog('no CI checks reported yet')).toBe('not-ready');
		expect(ciChecksFromLog('re-arming CI monitor timeout')).toBe('unknown');
	});

	it('reads a run’s ci.log from the no-mistakes logs folder', async () => {
		const logs = path.join(dir, 'logs');
		mkdirSync(path.join(logs, RUN), { recursive: true });
		writeFileSync(
			path.join(logs, RUN, 'ci.log'),
			'repository declares no CI (no_ci: true) - treating as all checks passed - still monitoring until merged or closed\n'
		);
		const r = new EvidenceReader({ dataDir: data, useGh: false, evidenceDir: nm, logsDir: logs });
		expect(await r.ciChecks(RUN)).toBe('green');
		expect(await r.ciChecks('01M4N1ZEQVFTTFH1M0780M75ZW')).toBe('unknown');
		expect(await r.ciChecks('../escape')).toBe('unknown');
		expect(await r.ciChecks(null)).toBe('unknown');
	});
});

describe('validation run progress', () => {
	const RUN = '01M4N30B7JVFV5989ZS2QEVZ7Q';
	let logs: string;
	const step = (name: string, text: string, mtimeSec: number) => {
		const f = path.join(logs, RUN, `${name}.log`);
		writeFileSync(f, text);
		utimesSync(f, mtimeSec, mtimeSec);
	};
	beforeEach(() => {
		logs = path.join(dir, 'logs');
		mkdirSync(path.join(logs, RUN), { recursive: true });
	});
	const r = () =>
		new EvidenceReader({ dataDir: data, useGh: false, evidenceDir: nm, logsDir: logs });

	it('reads a fix round only while it is under way', () => {
		const log =
			'reviewing changes...\nuser-fix round starting after round 1 (2 findings selected)\n';
		expect(fixRoundFromLog(log)).toBe(1);
		expect(fixRoundFromLog(`${log}committed agent fixes: x\n\nreviewing changes...\n`)).toBeNull();
		expect(
			fixRoundFromLog(`${log}committed agent fixes\nuser-fix round starting after round 2\n`)
		).toBe(2);
		expect(fixRoundFromLog('reviewing changes...\n')).toBeNull();
	});

	it('places the run at its newest step log, with its fix round', async () => {
		step('intent', 'x', 1_791_700_000);
		step('rebase', 'x', 1_791_700_010);
		step('review', 'reviewing changes...\nuser-fix round starting after round 2\n', 1_791_700_500);
		const p = await r().pipeline(RUN);
		expect(p).toMatchObject({ step: 'review', label: 'Review', round: 2 });
		expect(p?.startedAt).toEqual(expect.any(String));
	});

	it('reads every step from the run’s status, in the task worktree, with fix commits and CI', async () => {
		const reads: [string, string][] = [];
		const status = `run:
  id: "${RUN}"
  status: running
  steps[3]{step,status,findings,duration_ms}:
    review,completed,3,1000
    pr,completed,0,10
    ci,running,0,0
  active_steps[1]{step,status,active_for,round_active_for,last_activity,agent_pid,round}:
    ci,running,2m,2m,"1s ago","1",round 1
`;
		step(
			'review',
			'user-fix round starting after round 1\ncommitted agent fixes: a\n',
			1_791_700_100
		);
		step('ci', 'CI checks running\nchecks failed: lint\n', 1_791_700_200);
		const reader = new EvidenceReader({
			dataDir: data,
			useGh: false,
			evidenceDir: nm,
			logsDir: logs,
			runStatus: async (id, wt) => {
				reads.push([id, wt]);
				return status;
			}
		});
		const p = await reader.pipeline(RUN, '/wt/a');
		expect(reads).toEqual([[RUN, '/wt/a']]);
		expect(p).toMatchObject({ step: 'ci', ci: 'red', outcome: 'running' });
		expect(p?.steps.map((s) => [s.key, s.state, s.findings, s.fixes])).toEqual([
			['review', 'done', 3, 1],
			['pr', 'done', 0, null],
			['ci', 'running', 0, 0]
		]);
		// Without a worktree, or when the status read fails, the step logs alone place the run.
		expect((await reader.pipeline(RUN))?.steps).toEqual([]);
		const failing = new EvidenceReader({
			dataDir: data,
			useGh: false,
			evidenceDir: nm,
			logsDir: logs,
			runStatus: async () => null
		});
		expect(await failing.pipeline(RUN, '/wt/a')).toMatchObject({ step: 'ci', steps: [] });
	});

	it('re-reads a running run every few seconds, and an ended run only after minutes', async () => {
		const status = (st: string) => `run:
  id: "${RUN}"
  status: ${st}
  steps[1]{step,status,findings,duration_ms}:
    review,${st === 'running' ? 'running' : 'completed'},0,10
`;
		let clock = 1_791_700_000_000;
		let st = 'running';
		let reads = 0;
		const reader = new EvidenceReader({
			dataDir: data,
			useGh: false,
			evidenceDir: nm,
			logsDir: logs,
			now: () => clock,
			runStatus: async () => {
				reads++;
				return status(st);
			}
		});
		expect(await reader.pipeline(RUN, '/wt/a')).toMatchObject({ outcome: 'running' });
		clock += 6_000;
		st = 'completed';
		expect(await reader.pipeline(RUN, '/wt/a')).toMatchObject({ outcome: 'passed' });
		expect(reads).toBe(2);
		clock += 60_000;
		await reader.pipeline(RUN, '/wt/a');
		expect(reads).toBe(2);
		clock += 5 * 60_000;
		await reader.pipeline(RUN, '/wt/a');
		expect(reads).toBe(3);
	});

	it('leaves the fix count unknown when the step log is longer than its read tail', async () => {
		step('review', `committed agent fixes: a\n${'x'.repeat(70 * 1024)}\n`, 1_791_700_100);
		const reader = new EvidenceReader({
			dataDir: data,
			useGh: false,
			evidenceDir: nm,
			logsDir: logs,
			runStatus: async () => `run:
  id: "${RUN}"
  status: completed
  steps[1]{step,status,findings,duration_ms}:
    review,completed,3,1000
`
		});
		const p = await reader.pipeline(RUN, '/wt/a');
		expect(p?.steps.map((s) => [s.key, s.findings, s.fixes])).toEqual([['review', 3, null]]);
	});

	it('reads which fix rounds followed an answer, and the CI result', () => {
		expect(answeredRoundFromLog('user-fix round starting after round 1')).toBe(true);
		expect(answeredRoundFromLog('user-fix round x\nauto-fix round 1/3 starting')).toBe(false);
		expect(answeredRoundFromLog('reviewing changes')).toBe(false);
		expect(
			fixCommitsFromLog('committed agent fixes: a\ncommitted CI repair for x\nno changes')
		).toBe(2);
		expect(ciResultFromLog('CI checks running')).toBe('pending');
		expect(ciResultFromLog('no CI checks reported yet')).toBe('pending');
		expect(ciResultFromLog('CI checks running\nissues detected: conflicts')).toBe('red');
		expect(ciResultFromLog('checks failed\nall CI checks passed - still monitoring')).toBe('green');
		expect(ciResultFromLog('')).toBe('unknown');
	});

	it('is null for unknown, malformed or missing runs', async () => {
		expect(await r().pipeline(null)).toBeNull();
		expect(await r().pipeline('../escape')).toBeNull();
		expect(await r().pipeline('01M4N1ZEQVFTTFH1M0780M75ZW')).toBeNull();
		writeFileSync(path.join(logs, RUN, 'notes.txt'), 'x');
		expect(await r().pipeline(RUN)).toBeNull();
	});
});

describe('pull request review feedback', () => {
	it('reads a github.com pull request URL, and nothing else', () => {
		expect(githubPull('https://github.com/chrisjowen/casebook/pull/6')).toEqual({
			owner: 'chrisjowen',
			repo: 'casebook',
			number: 6
		});
		expect(githubPull('https://github.com/o/r/pull/6/files')).toMatchObject({ number: 6 });
		expect(githubPull('https://gitlab.com/o/r/pull/6')).toBeNull();
		expect(githubPull('https://github.com/o/r/issues/6')).toBeNull();
	});

	const by = (login: string, type = 'User') => ({ author: { __typename: type, login } });
	const answer = (pr: Record<string, unknown>, viewer = 'captain') => ({
		data: {
			viewer: { login: viewer },
			repository: {
				pullRequest: {
					state: 'OPEN',
					isDraft: false,
					headRefOid: 'abc',
					author: { login: 'captain' },
					commits: { nodes: [{ commit: { oid: 'abc', committedDate: '2026-01-01T00:00:10Z' } }] },
					reviews: { nodes: [] },
					reviewThreads: { nodes: [] },
					comments: { nodes: [] },
					...pr
				}
			}
		}
	});
	const t0 = Date.parse('2026-01-01T00:00:00Z') / 1000;

	it('reads reviews, threads and PR comments with their times, commits, files and links', () => {
		const f = parsePrFeedback(
			answer(
				{
					reviews: {
						nodes: [
							{
								id: 'R1',
								state: 'CHANGES_REQUESTED',
								body: 'Rename the helper',
								submittedAt: '2026-01-01T00:00:05Z',
								url: 'https://github.com/o/r/pull/2#pullrequestreview-1',
								commit: { oid: 'old' },
								...by('reviewer')
							},
							{ id: 'R2', state: 'PENDING', body: 'draft', ...by('reviewer') }
						]
					},
					reviewThreads: {
						nodes: [
							{
								id: 'T1',
								isResolved: true,
								path: 'src/a.ts',
								line: null,
								originalLine: 12,
								comments: {
									nodes: [
										{
											id: 'C1',
											body: 'Use a constant here',
											createdAt: '2026-01-01T00:00:06Z',
											url: 'https://github.com/o/r/pull/2#discussion_r1',
											originalCommit: { oid: 'old' },
											...by('reviewer')
										}
									]
								}
							}
						]
					},
					comments: {
						nodes: [
							{
								id: 'I1',
								body: 'Also update the docs',
								createdAt: '2026-01-01T00:00:07Z',
								url: 'javascript:alert(1)',
								...by('reviewer')
							}
						]
					}
				},
				'captain'
			)
		);
		expect(f.state).toBe('open');
		expect(f.draft).toBe(false);
		expect(f.head).toEqual({ sha: 'abc', at: t0 + 10 });
		expect(f.items).toEqual([
			{
				id: 'R1',
				kind: 'review',
				state: 'CHANGES_REQUESTED',
				author: 'reviewer',
				text: 'Rename the helper',
				at: t0 + 5,
				url: 'https://github.com/o/r/pull/2#pullrequestreview-1',
				commitId: 'old',
				path: null,
				line: null,
				resolved: false
			},
			{
				id: 'T1',
				kind: 'thread',
				state: null,
				author: 'reviewer',
				text: 'Use a constant here',
				at: t0 + 6,
				url: 'https://github.com/o/r/pull/2#discussion_r1',
				commitId: 'old',
				path: 'src/a.ts',
				line: 12,
				resolved: true
			},
			{
				id: 'I1',
				kind: 'comment',
				state: null,
				author: 'reviewer',
				text: 'Also update the docs',
				at: t0 + 7,
				url: null,
				commitId: null,
				path: null,
				line: null,
				resolved: false
			}
		]);
	});

	it('counts the captain’s own feedback on a PR opened under the captain’s account', () => {
		// The captain reads GitHub as `captain`, and the worker opened the PR as `captain` too.
		const f = parsePrFeedback(
			answer({
				reviews: {
					nodes: [
						{
							id: 'R1',
							state: 'COMMENTED',
							body: 'Please rename x',
							submittedAt: '2026-01-01T00:00:20Z',
							commit: { oid: 'abc' },
							...by('captain')
						}
					]
				}
			})
		);
		expect(f.items.map((i) => i.id)).toEqual(['R1']);
		expect(addressingReview(t0 + 15, f)).toBe(true);
	});

	it('leaves out bots, empty reviews, thread replies and, under a worker identity, the author', () => {
		const thread = (id: string, who: ReturnType<typeof by>) => ({
			id,
			isResolved: false,
			path: 'a.ts',
			line: 3,
			comments: {
				nodes: [{ id: `${id}c`, body: 'x', createdAt: '2026-01-01T00:01:00Z', ...who }]
			}
		});
		const f = parsePrFeedback(
			answer(
				{
					author: { login: 'worker' },
					reviews: {
						nodes: [
							// A review that only wraps thread comments (or a reply) says nothing itself.
							{
								id: 'R0',
								state: 'COMMENTED',
								body: '',
								submittedAt: '2026-01-01T00:01:00Z',
								...by('captain')
							},
							{
								id: 'R1',
								state: 'COMMENTED',
								body: 'done',
								submittedAt: '2026-01-01T00:01:00Z',
								...by('worker')
							},
							{
								id: 'R2',
								state: 'APPROVED',
								body: 'lgtm',
								submittedAt: '2026-01-01T00:01:00Z',
								...by('captain')
							},
							{
								id: 'R3',
								state: 'COMMENTED',
								body: 'hi',
								submittedAt: '2026-01-01T00:01:00Z',
								...by('ci', 'Bot')
							}
						]
					},
					reviewThreads: {
						nodes: [
							thread('T1', by('worker')),
							thread('T2', by('coderabbitai[bot]')),
							thread('T3', by('captain'))
						]
					},
					comments: {
						nodes: [
							{ id: 'I1', body: 'Addressed', createdAt: '2026-01-01T00:01:00Z', ...by('worker') },
							{ id: 'I2', body: '', createdAt: '2026-01-01T00:01:00Z', ...by('captain') }
						]
					}
				},
				'captain'
			)
		);
		expect(f.items.map((i) => i.id)).toEqual(['T3']);
	});

	it('the query only reads', () => {
		expect(PR_FEEDBACK_QUERY.trim().startsWith('query(')).toBe(true);
		expect(PR_FEEDBACK_QUERY).not.toMatch(/mutation/i);
	});

	it('copes with unexpected answers', () => {
		expect(parsePrFeedback(null)).toEqual({ state: null, draft: null, head: null, items: [] });
		expect(parsePrFeedback({ data: { repository: { pullRequest: { reviews: 'x' } } } })).toEqual({
			state: null,
			draft: null,
			head: null,
			items: []
		});
	});
});
