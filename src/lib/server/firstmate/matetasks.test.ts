import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { REMOTE_UNREACHABLE, type AdapterResult } from './adapter';
import { EvidenceReader, WORKTREE_GONE } from './evidence';
import type { InboxNoteResult as Note } from './contracts';
import {
	MateTasks,
	mateTaskId,
	parseMateTaskId,
	parseMetaPr,
	parseMetaProject,
	parseStatusLog,
	STATUS_MAX_BYTES
} from './matetasks';
import { mateTaskSummaries } from './secondmates';
import type { MateTask, SecondMate } from '../../types';

const task = (id: string, o: Partial<MateTask> = {}): MateTask => ({
	id,
	title: `Task ${id}`,
	projectId: 'lumen',
	status: 'working',
	statusLabel: 'Working',
	doing: null,
	since: null,
	completedOn: null,
	pr: null,
	report: null,
	...o
});

const mate = (o: Partial<SecondMate>): SecondMate =>
	({
		id: 'tokyo',
		where: 'remote',
		host: 'tokyo-box',
		home: '/home/fm/tokyo',
		inFlight: [task('tk-1')],
		queued: [],
		landed: [task('tk-old', { status: 'landed', statusLabel: 'Landed' })],
		peek: { available: true, reason: null },
		health: { online: 'online' },
		...o
	}) as SecondMate;

const LOG = [
	'working [at=1793000000]: building the share API',
	'note [at=1793000060]: preview http://127.0.0.1:5173/share',
	'done [at=1793000120]: PR https://github.com/o/lumen/pull/42 checks green',
	'garbage line without a colon'
].join('\n');

const META =
	'window=fm:w1\nproject=/home/fm/tokyo/projects/wheelhouse\nkind=ship\nbranch=fm/tk-1-share\n';

/** What Firstmate's fm-review-diff.sh prints in the second mate's home for tk-1. */
const REVIEW = [
	'diff base: origin/main',
	' src/share.ts | 2 +-',
	' logo.png     | Bin 0 -> 3 bytes',
	' 2 files changed, 1 insertion(+), 1 deletion(-)',
	'',
	'diff --git a/src/share.ts b/src/share.ts',
	'index 1..2 100644',
	'--- a/src/share.ts',
	'+++ b/src/share.ts',
	'@@ -1 +1 @@',
	'-old',
	'+new',
	'diff --git a/logo.png b/logo.png',
	'new file mode 100644',
	'Binary files /dev/null and b/logo.png differ',
	''
].join('\n');

/** What its `--stat` run prints: the base and the summary alone. */
const STAT = REVIEW.slice(0, REVIEW.indexOf('\n\n') + 1);

const ok = (value: string): AdapterResult<string> => ({
	ok: true,
	value,
	observedAt: '2026-10-11T05:00:00Z',
	durationMs: 1
});
const failed = (
	exitCode: number,
	message = 'fm-on.sh exited with code 1'
): AdapterResult<string> => ({
	ok: false,
	observedAt: 'x',
	error: { kind: 'exit', script: 'fm-on.sh', message, exitCode }
});

const note = (outcome: 'created' | 'replay' = 'created'): AdapterResult<Note> => ({
	ok: true,
	value: {
		schema: 'fm-inbox-note.v1',
		outcome,
		noteId: 'n1',
		requestId: 'wh-1',
		saved: true,
		announced: true,
		acknowledged: false
	},
	observedAt: 'x',
	durationMs: 1
});

let home: string;
beforeEach(() => {
	home = mkdtempSync(path.join(tmpdir(), 'wh-mate-home-'));
	mkdirSync(path.join(home, 'state'));
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

function make(mates: SecondMate[]) {
	const adapter = {
		remoteFile: vi.fn(
			async (_mate: string, rel: string, _max: number): Promise<AdapterResult<string>> => ({
				ok: true,
				value: rel.endsWith('.meta') ? META : LOG,
				observedAt: '2026-10-11T05:00:00Z',
				durationMs: 1
			})
		),
		remoteReviewDiff: vi.fn(
			async (
				_mate: string,
				_task: string,
				o?: { stat?: boolean }
			): Promise<AdapterResult<string>> => ok(o?.stat ? STAT : REVIEW)
		),
		matePeekTask: vi.fn(),
		mateNote: vi.fn(async (): Promise<AdapterResult<Note>> => note())
	};
	const forwards = {
		open: vi.fn(async () => ({ ok: true as const, port: 41000 })),
		retain: vi.fn()
	};
	const check = vi.fn(
		async (p: { url: string; reportedAt: string } | null) =>
			({
				url: p?.url ?? null,
				reportedAt: p?.reportedAt ?? null,
				state: p ? 'live' : 'none',
				reason: null,
				checkedAt: 'x'
			}) as const
	);
	const clock = { t: 1_000 };
	const evidence = new EvidenceReader({
		dataDir: home,
		useGh: false,
		evidenceDir: null,
		logsDir: null
	});
	const tasks = new MateTasks({
		adapter,
		mates: () => mates,
		forwards,
		evidence,
		check,
		now: () => clock.t
	});
	return { tasks, adapter, forwards, check, clock };
}

describe('a second mate’s task id', () => {
	it('is <task>@<mate>, which no task of the captain’s can be', () => {
		expect(mateTaskId('tokyo', 'tk-1')).toBe('tk-1@tokyo');
		expect(parseMateTaskId('tk-1@tokyo')).toEqual({ mate: 'tokyo', task: 'tk-1' });
		for (const bad of ['tk-1', '@tokyo', 'tk-1@', 'a b@tokyo', 'tk-1@-x', '../x@tokyo']) {
			expect(parseMateTaskId(bad)).toBeNull();
		}
	});
});

describe('a second mate’s task status log', () => {
	it('gives its history, latest preview and pull request', () => {
		const log = parseStatusLog(LOG);
		expect(log.lines.map((l) => l.state)).toEqual(['working', 'note', 'done']);
		expect(log.preview).toEqual({
			url: 'http://127.0.0.1:5173/share',
			reportedAt: new Date(1793000060 * 1000).toISOString()
		});
		expect(log.pr).toBe('https://github.com/o/lumen/pull/42');
	});
});

describe('a remote second mate’s task', () => {
	it('reads its status log on its host, at most every 10 s, and keeps its PR and preview', async () => {
		const { tasks, adapter } = make([mate({})]);
		const log = await tasks.log('tk-1@tokyo');
		expect(log.ok && log.value.pr).toBe('https://github.com/o/lumen/pull/42');
		expect(log.ok && log.value.preview?.url).toBe('http://127.0.0.1:5173/share');
		expect(tasks.facts('tk-1@tokyo')).toEqual({
			pr: 'https://github.com/o/lumen/pull/42',
			preview: { url: 'http://127.0.0.1:5173/share', reportedAt: expect.any(String) },
			projectId: 'wheelhouse',
			filesChanged: null
		});
		await tasks.log('tk-1@tokyo');
		expect(adapter.remoteFile).toHaveBeenCalledTimes(2);
		expect(adapter.remoteFile).toHaveBeenCalledWith('tokyo', 'state/tk-1.status', 262144);
		expect(adapter.remoteFile).toHaveBeenCalledWith('tokyo', 'state/tk-1.meta', 16384);
	});

	it('takes its project from its meta file once, as a task of the captain’s does', async () => {
		const mates = [mate({})];
		const { tasks, adapter } = make(mates);
		await tasks.log('tk-1@tokyo');
		await tasks.refresh();
		const metaReads = adapter.remoteFile.mock.calls.filter(([, rel]) => rel.endsWith('.meta'));
		expect(metaReads).toHaveLength(1);
		expect(tasks.facts('tk-1@tokyo')?.projectId).toBe('wheelhouse');
		// Kept while its second mate lists it, forgotten once it does not.
		tasks.retain();
		expect(tasks.facts('tk-1@tokyo')?.projectId).toBe('wheelhouse');
		mates[0].inFlight = [];
		tasks.retain();
		expect(tasks.facts('tk-1@tokyo')).toBeNull();
	});

	it('does not read a missing meta file on every read, but again once its host is back', async () => {
		const { tasks, adapter, clock } = make([mate({})]);
		const metaReads = () =>
			adapter.remoteFile.mock.calls.filter(([, rel]) => rel.endsWith('.meta')).length;
		const fail = (exitCode: number) =>
			adapter.remoteFile.mockImplementation(async (_m, rel) =>
				rel.endsWith('.meta')
					? {
							ok: false,
							observedAt: 'x',
							error: { kind: 'exit', script: 'fm-on.sh', message: 'no such file', exitCode }
						}
					: { ok: true, value: LOG, observedAt: 'x', durationMs: 1 }
			);
		fail(255);
		await tasks.log('tk-1@tokyo');
		fail(1);
		clock.t += 10_000;
		await tasks.log('tk-1@tokyo');
		expect(metaReads()).toBe(2);
		for (let i = 0; i < 5; i++) {
			clock.t += 10_000;
			await tasks.log('tk-1@tokyo');
		}
		expect(metaReads()).toBe(2);
		expect(tasks.facts('tk-1@tokyo')?.projectId).toBeNull();
	});

	it('keeps the last 256 KiB of a status log too big to send whole at that size, as a local one is read', async () => {
		const { tasks, adapter } = make([mate({})]);
		const filler = 'note [at=1793000001]: ' + 'x'.repeat(1000) + '\n';
		const big = filler.repeat(300) + LOG;
		adapter.remoteFile.mockImplementation(async (_m, rel, max) =>
			rel.endsWith('.meta')
				? { ok: true, value: META, observedAt: 'x', durationMs: 1 }
				: Buffer.byteLength(big) > max
					? {
							ok: false,
							observedAt: 'x',
							error: {
								kind: 'exit',
								script: 'fm-on.sh',
								message: `exited with code 1: error: file exceeds max-bytes: ${rel}`,
								exitCode: 1
							}
						}
					: { ok: true, value: big, observedAt: 'x', durationMs: 1 }
		);
		const log = await tasks.log('tk-1@tokyo');
		expect(log.ok).toBe(true);
		if (!log.ok) return;
		expect(log.value.truncated).toBe(true);
		expect(log.value.pr).toBe('https://github.com/o/lumen/pull/42');
		expect(log.value.preview?.url).toBe('http://127.0.0.1:5173/share');
		expect(log.value.lines.at(-1)?.state).toBe('done');
		expect(log.value.lines.length).toBeLessThan(300);
		const sizes = adapter.remoteFile.mock.calls
			.filter(([, rel]) => rel.endsWith('.status'))
			.map(([, , max]) => max);
		expect(sizes).toEqual([STATUS_MAX_BYTES, 1024 * 1024]);
		// Known to be big now, so the next read asks for it whole at once.
		await tasks.refresh();
		await tasks.preview('tk-1@tokyo', 'o');
		expect(
			adapter.remoteFile.mock.calls.filter(([, rel]) => rel.endsWith('.status')).at(-1)?.[2]
		).toBe(1024 * 1024);
	});

	it('keeps its PR and preview and says its history is cut when its status log is past even that', async () => {
		const { tasks, adapter, clock } = make([mate({})]);
		await tasks.log('tk-1@tokyo');
		// The log has since grown past fm-remote-file.sh's 1 MiB bound.
		adapter.remoteFile.mockImplementation(async (_m, rel) =>
			rel.endsWith('.meta')
				? { ok: true, value: META, observedAt: 'x', durationMs: 1 }
				: {
						ok: false,
						observedAt: 'x',
						error: {
							kind: 'exit',
							script: 'fm-on.sh',
							message: `exited with code 1: error: file exceeds max-bytes: ${rel}`,
							exitCode: 1
						}
					}
		);
		clock.t += 60_000;
		expect(await tasks.log('tk-1@tokyo')).toMatchObject({
			ok: true,
			value: {
				lines: [],
				truncated: true,
				pr: 'https://github.com/o/lumen/pull/42',
				preview: { url: 'http://127.0.0.1:5173/share' }
			}
		});
		expect(tasks.facts('tk-1@tokyo')?.pr).toBe('https://github.com/o/lumen/pull/42');
		const c = await tasks.preview('tk-1@tokyo', 'o');
		expect(c.url).toBe('http://127.0.0.1:41000/share');
	});

	it('takes its PR from its meta file when its status log is past that bound, with nothing read before', async () => {
		const PR = 'https://github.com/o/wheelhouse/pull/103';
		const { tasks, adapter, clock } = make([mate({})]);
		let meta = META;
		adapter.remoteFile.mockImplementation(async (_m, rel) =>
			rel.endsWith('.meta')
				? { ok: true, value: meta, observedAt: 'x', durationMs: 1 }
				: {
						ok: false,
						observedAt: 'x',
						error: {
							kind: 'exit',
							script: 'fm-on.sh',
							message: `exited with code 1: error: file exceeds max-bytes: ${rel}`,
							exitCode: 1
						}
					}
		);
		const first = await tasks.log('tk-1@tokyo');
		expect(first).toMatchObject({ ok: true, value: { lines: [], cut: true, pr: null } });
		const c = await tasks.preview('tk-1@tokyo', 'o');
		expect(c).toMatchObject({ url: null, state: 'none' });
		expect(c.reason).toContain('past the 1 MiB');
		// Firstmate records its PR later; a cut log reads the meta again, not at every read.
		meta = `${META}pr=https://github.com/o/wheelhouse/pull/1\npr=${PR}\n`;
		clock.t += 60_000;
		expect(await tasks.log('tk-1@tokyo')).toMatchObject({ ok: true, value: { pr: null } });
		clock.t += 10 * 60_000;
		expect(await tasks.log('tk-1@tokyo')).toMatchObject({ ok: true, value: { pr: PR } });
		expect(tasks.facts('tk-1@tokyo')).toMatchObject({ pr: PR, projectId: 'wheelhouse' });
		// So its card carries that PR, and lands once GitHub says it merged.
		const [card] = mateTaskSummaries(mate({ landed: [] }), {
			facts: (id) => tasks.facts(id),
			prState: (id) => (id === 'tk-1@tokyo' ? 'merged' : null),
			nowSeconds: 0
		});
		expect(card).toMatchObject({ id: 'tk-1@tokyo', status: 'landed', pr: { url: PR } });
	});

	it('shows its preview here through a forward of only the reported port', async () => {
		const { tasks, forwards, check } = make([mate({})]);
		const c = await tasks.preview('tk-1@tokyo', 'http://127.0.0.1:4310');
		expect(forwards.open).toHaveBeenCalledWith('tokyo-box', 5173);
		expect(c.url).toBe('http://127.0.0.1:41000/share');
		expect(check).toHaveBeenCalledWith(
			{ url: 'http://127.0.0.1:41000/share', reportedAt: expect.any(String) },
			'http://127.0.0.1:4310',
			{ landed: false }
		);
		tasks.retain();
		expect(forwards.retain).toHaveBeenLastCalledWith(new Set(['tokyo-box:5173']));
	});

	it('never forwards a preview that is not on its host’s loopback', async () => {
		const { tasks, adapter, forwards } = make([mate({})]);
		adapter.remoteFile.mockResolvedValueOnce({
			ok: true,
			value: 'note: preview https://evil.example/x',
			observedAt: 'x',
			durationMs: 1
		});
		const c = await tasks.preview('tk-1@tokyo', 'http://127.0.0.1:4310');
		expect(c.state).toBe('refused');
		expect(forwards.open).not.toHaveBeenCalled();
	});

	it('reads as offline when its host cannot be reached (exit 255)', async () => {
		const { tasks, adapter } = make([mate({})]);
		adapter.remoteFile.mockResolvedValueOnce({
			ok: false,
			observedAt: 'x',
			error: { kind: 'exit', script: 'fm-on.sh', message: 'exit 255', exitCode: 255 }
		});
		const c = await tasks.preview('tk-1@tokyo', 'o');
		expect(c.state).toBe('down');
		expect(c.reason).toContain('could not reach tokyo-box');
		adapter.matePeekTask.mockResolvedValueOnce({
			ok: false,
			observedAt: 'x',
			error: { kind: 'exit', script: 'fm-on.sh', message: 'exit 255', exitCode: 255 }
		});
		const out = await tasks.output('tk-1@tokyo', 40);
		expect(out).toMatchObject({ available: false });
		expect(out.reason).toContain('could not reach tokyo-box');
	});

	it('sends feedback to its own second mate about it, under the id that home knows', async () => {
		const { tasks, adapter } = make([mate({})]);
		const r = await tasks.send(
			'tk-1@tokyo',
			'wh-1',
			'Preview feedback for tk-1@tokyo (Task tk-1), sent together:\n1. Bigger button'
		);
		expect(r).toEqual({ ok: true, created: true, announced: true });
		expect(adapter.mateNote).toHaveBeenCalledWith(
			{ id: 'tokyo', remote: true },
			'wh-1',
			'Re: tk-1\nPreview feedback for tk-1 (Task tk-1), sent together:\n1. Bigger button'
		);
	});

	it('does not resend feedback its host may not have had', async () => {
		const { tasks, adapter } = make([mate({})]);
		adapter.mateNote.mockResolvedValueOnce({
			ok: false,
			observedAt: 'x',
			error: { kind: 'exit', script: 'fm-on.sh', message: 'exit 255', exitCode: 255 }
		});
		const r = await tasks.send('tk-1@tokyo', 'wh-1', 'hi');
		expect(r).toMatchObject({ ok: false, status: 502 });
		expect(adapter.mateNote).toHaveBeenCalledTimes(1);
	});

	it('is refused for a task its second mate does not list', async () => {
		const { tasks, adapter } = make([mate({})]);
		expect(tasks.find('tk-9@tokyo')).toMatchObject({ ok: false, status: 404 });
		expect(await tasks.send('tk-9@tokyo', 'wh-1', 'hi')).toMatchObject({ ok: false, status: 404 });
		expect(adapter.mateNote).not.toHaveBeenCalled();
	});
});

describe('a remote second mate’s task changes', () => {
	it('lists them from Firstmate’s review diff on its host, as a local task lists its own', async () => {
		const { tasks, adapter } = make([mate({})]);
		const files = await tasks.changes('tk-1@tokyo');
		expect(adapter.remoteReviewDiff).toHaveBeenCalledWith('tokyo', 'tk-1');
		expect(files).toMatchObject({
			available: true,
			source: expect.stringContaining('fm-review-diff.sh'),
			observedAt: '2026-10-11T05:00:00Z',
			value: {
				base: 'origin/main',
				branch: 'fm/tk-1-share',
				total: 2,
				truncated: false,
				committedOnly: { mate: 'tokyo' },
				files: [
					{ path: 'src/share.ts', status: 'M', additions: 1, deletions: 1 },
					{ path: 'logo.png', status: 'A', additions: null, deletions: null }
				]
			}
		});
	});

	it('shows one listed file’s diff from the same read, and nothing it does not list', async () => {
		const { tasks, adapter } = make([mate({})]);
		const d = await tasks.fileDiff('tk-1@tokyo', 'src/share.ts');
		expect(d).toMatchObject({
			available: true,
			value: { path: 'src/share.ts', base: 'origin/main', lines: ['@@ -1 +1 @@', '-old', '+new'] }
		});
		expect(await tasks.fileDiff('tk-1@tokyo', 'logo.png')).toMatchObject({
			available: false,
			reason: expect.stringMatching(/binary/)
		});
		expect(await tasks.fileDiff('tk-1@tokyo', '../etc/passwd')).toMatchObject({
			available: false,
			reason: expect.stringMatching(/not in this task’s list/)
		});
		// One compare on the host serves the list and every file's diff for 30 s.
		await tasks.changes('tk-1@tokyo');
		expect(adapter.remoteReviewDiff).toHaveBeenCalledTimes(1);
	});

	it('compares again after 30 s, and says nothing is changed when nothing is', async () => {
		const { tasks, adapter, clock } = make([mate({})]);
		await tasks.changes('tk-1@tokyo');
		adapter.remoteReviewDiff.mockResolvedValue(ok('diff base: main\nno changes vs main\n'));
		clock.t += 29_000;
		expect((await tasks.changes('tk-1@tokyo')).available).toBe(true);
		expect(adapter.remoteReviewDiff).toHaveBeenCalledTimes(1);
		clock.t += 2_000;
		const files = await tasks.changes('tk-1@tokyo');
		expect(adapter.remoteReviewDiff).toHaveBeenCalledTimes(2);
		expect(files.available && files.value.files).toEqual([]);
	});

	it('says its host is offline', async () => {
		const { tasks, adapter, clock } = make([mate({})]);
		await tasks.changes('tk-1@tokyo');
		adapter.remoteReviewDiff.mockResolvedValue(failed(REMOTE_UNREACHABLE));
		clock.t += 31_000;
		expect(await tasks.changes('tk-1@tokyo')).toEqual({
			available: false,
			reason: expect.stringMatching(/^Offline: Firstmate could not reach tokyo-box/)
		});
		expect(await tasks.fileDiff('tk-1@tokyo', 'src/share.ts')).toMatchObject({
			available: false,
			reason: expect.stringMatching(/^Offline/)
		});
	});

	it('says why when its home cannot compare them', async () => {
		const { tasks, adapter, clock } = make([mate({})]);
		adapter.remoteReviewDiff.mockResolvedValue(
			failed(1, 'fm-on.sh exited with code 1: error: base origin/main does not exist in /wt')
		);
		expect(await tasks.changes('tk-1@tokyo')).toEqual({
			available: false,
			reason:
				'Its changes cannot be read in second mate tokyo’s home: fm-on.sh exited with code 1: error: base origin/main does not exist in /wt'
		});
		// A worktree cleaned up there reads as one of the captain's does once it is gone.
		adapter.remoteReviewDiff.mockResolvedValue(
			failed(1, 'fm-on.sh exited with code 1: error: worktree for task tk-1 is missing: /wt')
		);
		clock.t += 31_000;
		expect(await tasks.changes('tk-1@tokyo')).toEqual({
			available: false,
			reason: 'The worktree is gone, so the changed files are not kept.'
		});
		// Output that is not a review diff is never read as one.
		adapter.remoteReviewDiff.mockResolvedValue(ok('Usage: something else'));
		clock.t += 31_000;
		expect(await tasks.changes('tk-1@tokyo')).toEqual({
			available: false,
			reason: expect.stringMatching(/said something unexpected/)
		});
	});

	it('does not compare a task that has not started', async () => {
		const { tasks, adapter } = make([
			mate({ inFlight: [], queued: [task('tk-2', { status: 'queued' })] })
		]);
		expect(await tasks.changes('tk-2@tokyo')).toEqual({
			available: false,
			reason: 'Work has not started.'
		});
		expect(adapter.remoteReviewDiff).not.toHaveBeenCalled();
	});

	it('counts its in-flight cards’ files in the background from the --stat summary alone, at most every minute', async () => {
		const { tasks, adapter, clock } = make([mate({})]);
		await tasks.refresh();
		await vi.waitFor(() => expect(tasks.facts('tk-1@tokyo')?.filesChanged).toBe(2));
		const [card] = mateTaskSummaries(mate({ landed: [] }), {
			facts: (id) => tasks.facts(id),
			nowSeconds: 0
		});
		expect(card).toMatchObject({ id: 'tk-1@tokyo', filesChanged: 2 });
		// The background never fetches the full diff.
		expect(adapter.remoteReviewDiff.mock.calls).toEqual([['tokyo', 'tk-1', { stat: true }]]);
		clock.t += 40_000;
		await tasks.refresh();
		expect(adapter.remoteReviewDiff).toHaveBeenCalledTimes(1);
		clock.t += 21_000;
		adapter.remoteReviewDiff.mockResolvedValue(ok('diff base: main\nno changes vs main\n'));
		await tasks.refresh();
		await vi.waitFor(() => expect(tasks.facts('tk-1@tokyo')?.filesChanged).toBe(0));
		expect(adapter.remoteReviewDiff).toHaveBeenCalledTimes(2);
	});

	it('keeps a card’s count while its host is offline, and clears it when the count cannot be read', async () => {
		const { tasks, adapter, clock } = make([mate({})]);
		await tasks.refresh();
		await vi.waitFor(() => expect(tasks.facts('tk-1@tokyo')?.filesChanged).toBe(2));
		adapter.remoteReviewDiff.mockResolvedValue(failed(REMOTE_UNREACHABLE));
		clock.t += 61_000;
		await tasks.refresh();
		await vi.waitFor(() => expect(adapter.remoteReviewDiff).toHaveBeenCalledTimes(2));
		await new Promise((r) => setTimeout(r, 0));
		expect(tasks.facts('tk-1@tokyo')?.filesChanged).toBe(2);
		adapter.remoteReviewDiff.mockResolvedValue(failed(1, 'error: base main does not exist'));
		clock.t += 61_000;
		await tasks.refresh();
		await vi.waitFor(() => expect(tasks.facts('tk-1@tokyo')?.filesChanged).toBeNull());
	});

	it('reads status logs on time while a count read never ends', async () => {
		const { tasks, adapter, clock } = make([mate({})]);
		adapter.remoteReviewDiff.mockReturnValue(new Promise(() => {}));
		await tasks.refresh();
		expect(tasks.facts('tk-1@tokyo')?.pr).toBe('https://github.com/o/lumen/pull/42');
		adapter.remoteFile.mockResolvedValue(ok(LOG.replace('pull/42', 'pull/43')));
		clock.t += 61_000;
		await tasks.refresh();
		expect(tasks.facts('tk-1@tokyo')?.pr).toBe('https://github.com/o/lumen/pull/43');
		// That task's count is not asked for again while its last read is still out.
		expect(adapter.remoteReviewDiff).toHaveBeenCalledTimes(1);
	});
});

describe('a task’s meta file', () => {
	it('names its project as a task of the captain’s is named', () => {
		expect(parseMetaProject(META, '/home/fm/tokyo')).toBe('wheelhouse');
		expect(parseMetaProject('repo=lumen\nproject=/x/atlas\n', null)).toBe('lumen');
		expect(parseMetaProject('project=/home/fm/tokyo\n', '/home/fm/tokyo')).toBe('firstmate');
		expect(parseMetaProject('kind=ship\n', '/home/fm/tokyo')).toBeNull();
		// Its last value counts, as fm_meta_get reads it.
		expect(parseMetaProject('repo=old\nkind=ship\nrepo=lumen\n', null)).toBe('lumen');
		expect(parseMetaProject('project=/x/old\nproject=/x/atlas\n', null)).toBe('atlas');
	});

	it('records its pull request, its last value counting', () => {
		expect(
			parseMetaPr('pr=https://github.com/o/a/pull/1\npr=https://github.com/o/a/pull/2\n')
		).toBe('https://github.com/o/a/pull/2');
		expect(parseMetaPr(META)).toBeNull();
	});
});

describe('a local second mate’s task', () => {
	it('reads its status log in that home and shows its preview as it is', async () => {
		writeFileSync(path.join(home, 'state', 'os-1.status'), LOG);
		const local = mate({
			id: 'osaka',
			where: 'local',
			host: null,
			home,
			inFlight: [task('os-1')]
		});
		const { tasks, adapter, forwards } = make([local]);
		const c = await tasks.preview('os-1@osaka', 'o');
		expect(c.url).toBe('http://127.0.0.1:5173/share');
		expect(forwards.open).not.toHaveBeenCalled();
		expect(adapter.remoteFile).not.toHaveBeenCalled();
		await tasks.send('os-1@osaka', 'wh-2', 'hi');
		expect(adapter.mateNote).toHaveBeenCalledWith(
			{ id: 'osaka', remote: false, home },
			'wh-2',
			'Re: os-1\nhi'
		);
	});

	it('reads its changes in the worktree its meta records, uncommitted and untracked ones too', async () => {
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
			});
		const repo = path.join(home, 'repo');
		mkdirSync(repo);
		g(repo, 'init', '-q', '-b', 'main');
		writeFileSync(path.join(repo, 'a.txt'), 'one\n');
		g(repo, 'add', '.');
		g(repo, 'commit', '-q', '-m', 'base');
		g(repo, 'checkout', '-q', '-b', 'fm/os-1');
		writeFileSync(path.join(repo, 'a.txt'), 'one\ntwo\n');
		writeFileSync(path.join(repo, 'new.txt'), 'n\n');
		writeFileSync(path.join(home, 'state', 'os-1.meta'), `worktree=${repo}\nproject=${repo}\n`);
		const local = mate({ id: 'osaka', where: 'local', host: null, home, inFlight: [task('os-1')] });
		const { tasks, adapter } = make([local]);
		const files = await tasks.changes('os-1@osaka');
		expect(files.available && files.value.files.map((f) => [f.path, f.status])).toEqual([
			['a.txt', 'M'],
			['new.txt', '?']
		]);
		expect(await tasks.fileDiff('os-1@osaka', 'a.txt')).toMatchObject({
			available: true,
			value: { lines: ['@@ -1 +1,2 @@', ' one', '+two'] }
		});
		expect(adapter.remoteReviewDiff).not.toHaveBeenCalled();
		rmSync(repo, { recursive: true, force: true });
		const { tasks: later } = make([local]);
		expect(await later.changes('os-1@osaka')).toEqual({ available: false, reason: WORKTREE_GONE });
	});
});
