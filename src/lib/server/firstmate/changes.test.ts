import { describe, expect, it } from 'vitest';
import {
	taskRuns,
	isChangeRequest,
	readyTimes,
	wheelhouseRequest,
	type PrFeedback,
	type PrFeedbackItem
} from './changes';
import { LedgerReader, type LedgerTask } from './ledger';
import { answerText, optionsFor, type InboxCard } from '../../inbox';
import { feedbackNote } from '../../preview';
import { changeNote } from '../../prreview';
import type { BridgeMessage } from '../../types';

const PR = 'https://github.com/o/r/pull/2';
const iso = (ts: number) => new Date(ts * 1000).toISOString();

const head = (sha: string, at: number | null) => ({ sha, at });
const item = (o: Partial<PrFeedbackItem> & { at: number }): PrFeedbackItem => ({
	id: `i${o.at}`,
	kind: 'thread',
	state: null,
	author: 'captain',
	text: 'Rename x',
	url: 'https://github.com/o/r/pull/2#discussion_r1',
	path: 'src/a.ts',
	line: 4,
	resolved: false,
	...o
});
const feedback = (o: Partial<PrFeedback> = {}): PrFeedback => ({
	state: 'open',
	draft: false,
	head: head('h1', 900),
	items: [],
	...o
});
const changes = (at: number) =>
	item({ kind: 'review', state: 'CHANGES_REQUESTED', at, path: null, line: null });

/** A ledger for task `a`: [ts, state, text] status lines, and ready reports at the given times. */
function ledger(statuses: [number, string, string][], ready: number[] = []): LedgerTask {
	const l = new LedgerReader('/nonexistent');
	const lines = [
		...statuses.map(([ts, state, text]) => ({
			v: 1,
			ts,
			event: 'task.status',
			task: 'a',
			state,
			key: null,
			text
		})),
		...ready.map((ts) => ({ v: 1, ts, event: 'task.pr_ready', task: 'a', pr: PR }))
	].sort((x, y) => x.ts - y.ts);
	for (const line of lines) l.ingest(JSON.stringify(line));
	return l.task('a')!;
}
const readyAt = (ts: number): [number, string, string] => [ts, 'done', `PR ${PR} checks green`];

const message = (o: Partial<BridgeMessage> & { text: string; at: number }): BridgeMessage => ({
	requestId: `m${o.at}`,
	taskId: 'a',
	submittedAt: iso(o.at),
	delivery: 'delivered',
	deliveryDetail: null,
	acknowledged: true,
	noteId: null,
	reply: null,
	...o
});

const card: InboxCard = {
	id: 'a:merge-pr',
	taskId: 'a',
	taskTitle: 'Task A',
	projectId: null,
	kind: 'merge',
	key: 'merge-pr',
	question: 'Pull request #2 is ready for your review.',
	askedAt: null,
	owner: 'captain',
	evidence: {
		text: null,
		findings: [],
		file: null,
		pr: { url: PR, number: 2 },
		preview: null,
		checks: 'green',
		screenshots: []
	},
	options: optionsFor('merge'),
	recommendation: null,
	sent: null
};

describe('readyTimes', () => {
	it('takes the worker’s CI-ready lines and the ledger’s ready record for this PR', () => {
		const l = ledger([readyAt(900), [950, 'working', 'more'], readyAt(1200)], [910]);
		expect(readyTimes(PR, l)).toEqual([900, 910, 1200]);
		expect(readyTimes('https://github.com/o/r/pull/9', l)).toEqual([900, 1200]);
		expect(readyTimes(PR, null)).toEqual([]);
	});
});

describe('wheelhouseRequest', () => {
	it('reads preview feedback, a change asked from the PR review and a Decisions Fix', () => {
		expect(
			wheelhouseRequest(message({ at: 1, text: feedbackNote('http://127.0.0.1:4436/', 'Bigger') }))
		).toEqual({ kind: 'preview', text: 'Bigger', where: null });
		expect(
			wheelhouseRequest(
				message({
					at: 1,
					text: changeNote({ url: PR }, { path: 'src/a.ts', newStart: 12 }, 'Use a const')
				})
			)
		).toEqual({ kind: 'pr-review', text: 'Use a const', where: { path: 'src/a.ts', line: 12 } });
		expect(
			wheelhouseRequest(message({ at: 1, text: answerText(card, 'fix', 'Split the commit') }))
		).toEqual({ kind: 'decision', text: 'Split the commit', where: null });
		expect(wheelhouseRequest(message({ at: 1, text: answerText(card, 'fix', null) }))?.text).toBe(
			'Fix: Pull request #2 is ready for your review.'
		);
	});

	it('a change request is one about a task', () => {
		const text = feedbackNote('http://127.0.0.1:1/', 'Bigger');
		expect(isChangeRequest({ taskId: 'a', text })).toBe(true);
		expect(isChangeRequest({ taskId: null, text })).toBe(false);
		expect(isChangeRequest({ taskId: 'a', text: 'How is it going?' })).toBe(false);
	});

	it('leaves other messages alone', () => {
		expect(wheelhouseRequest(message({ at: 1, text: 'How is it going?' }))).toBeNull();
		expect(
			wheelhouseRequest(message({ at: 1, text: answerText(card, 'approve', null) }))
		).toBeNull();
	});
});

describe('taskRuns', () => {
	const base = { prUrl: PR, taskId: 'a', sent: [] as BridgeMessage[], feedback: null };
	const withDispatch = (l: LedgerTask) => ({
		...l,
		dispatched: { ts: 500, kind: 'ship', project: 'p', harness: 'claude', model: null }
	});

	it('is null before the PR was ever reported ready', () => {
		expect(
			taskRuns({ ...base, ledger: ledger([[900, 'working', 'x']]), feedback: feedback() })
		).toBeNull();
	});

	it('is one run while nothing was asked after the ready report', () => {
		const r = taskRuns({ ...base, ledger: withDispatch(ledger([readyAt(1000)])) })!;
		expect(r.current).toBe(1);
		expect(r.reworking).toBe(false);
		expect(r.runs).toEqual([
			{
				n: 1,
				startedAt: iso(500),
				readyAt: iso(1000),
				endedAt: null,
				outcome: 'ready',
				basis: null,
				changes: []
			}
		]);
	});

	it('GitHub: a review thread after the ready report starts run 2 with it, file and line', () => {
		const r = taskRuns({
			...base,
			ledger: ledger([readyAt(1000)]),
			feedback: feedback({ items: [item({ at: 1100 })] })
		})!;
		expect(r.current).toBe(2);
		expect(r.reworking).toBe(true);
		expect(r.runs[0]).toMatchObject({
			n: 1,
			readyAt: iso(1000),
			endedAt: iso(1100),
			outcome: 'changes-requested'
		});
		expect(r.runs[1]).toMatchObject({
			n: 2,
			startedAt: iso(1100),
			readyAt: null,
			outcome: 'building',
			basis: 'You asked for changes on GitHub after run 1 was reported ready.'
		});
		expect(r.runs[1].changes).toEqual([
			{
				id: 'github:i1100',
				source: 'github',
				kind: 'thread',
				author: 'captain',
				text: 'Rename x',
				at: iso(1100),
				url: 'https://github.com/o/r/pull/2#discussion_r1',
				where: { path: 'src/a.ts', line: 4 },
				state: 'open'
			}
		]);
	});

	it('GitHub: a changes-requested review with no words still reads as one', () => {
		const r = taskRuns({
			...base,
			ledger: ledger([readyAt(1000)]),
			feedback: feedback({ items: [changes(1100)].map((x) => ({ ...x, text: '' })) })
		})!;
		expect(r.runs[1].changes[0].text).toBe('Changes requested.');
	});

	it('GitHub: run 2 is ready once the worker pushes and reports ready again, and run 1 stays', () => {
		const r = taskRuns({
			...base,
			ledger: ledger([readyAt(1000), [1150, 'working', 'addressing review'], readyAt(1300)]),
			feedback: feedback({
				head: head('h2', 1250),
				items: [item({ at: 1100 }), item({ at: 1120, id: 't2', resolved: true })]
			})
		})!;
		expect(r.reworking).toBe(false);
		expect(r.runs.map((x) => [x.n, x.outcome])).toEqual([
			[1, 'changes-requested'],
			[2, 'ready']
		]);
		expect(r.runs[1].readyAt).toBe(iso(1300));
		expect(r.runs[1].changes.map((i) => i.state)).toEqual(['addressed', 'resolved']);
	});

	it('GitHub: a ready report after a review ends the run even when the head did not move', () => {
		const r = taskRuns({
			...base,
			ledger: ledger([readyAt(1000), readyAt(1300)]),
			feedback: feedback({ items: [changes(1100), item({ at: 1150 })] })
		})!;
		expect(r.current).toBe(2);
		expect(r.reworking).toBe(false);
		expect(r.runs[1]).toMatchObject({ outcome: 'ready', readyAt: iso(1300) });
		expect(r.runs[1].changes.map((i) => i.state)).toEqual(['addressed', 'addressed']);
	});

	it('a third run starts when changes are asked again after run 2 was ready', () => {
		const r = taskRuns({
			...base,
			ledger: ledger([readyAt(1000), readyAt(1300)]),
			feedback: feedback({
				head: head('h2', 1250),
				items: [item({ at: 1100 }), item({ at: 1400, id: 'second' })]
			})
		})!;
		expect(r.runs.map((x) => [x.n, x.outcome, x.changes.map((c) => c.id)])).toEqual([
			[1, 'changes-requested', []],
			[2, 'changes-requested', ['github:i1100']],
			[3, 'building', ['github:second']]
		]);
	});

	it('GitHub: a merged or closed PR is nobody’s turn', () => {
		const items = [item({ at: 1100 })];
		const closed = taskRuns({
			...base,
			ledger: ledger([readyAt(1000)]),
			feedback: feedback({ state: 'closed', items })
		})!;
		expect(closed.reworking).toBe(false);
		expect(closed.runs.at(-1)!.outcome).toBe('closed');
		const merged = taskRuns({
			...base,
			merged: true,
			ledger: ledger([readyAt(1000)]),
			feedback: feedback({ items })
		})!;
		expect(merged.runs.at(-1)!.outcome).toBe('landed');
	});

	it('GitHub: new commits alone start a run and say so', () => {
		const r = taskRuns({
			...base,
			ledger: ledger([readyAt(1000)]),
			feedback: feedback({ head: head('h2', 1100) })
		})!;
		expect(r.reworking).toBe(true);
		expect(r.runs[1].basis).toBe('New commits were pushed after run 1 was reported ready.');
		expect(r.runs[1].changes).toEqual([]);
	});

	it('Wheelhouse: preview feedback or a Decisions Fix after the ready report starts the next run', () => {
		const sent = [
			message({ at: 900, text: feedbackNote('http://127.0.0.1:1/', 'Before the PR') }),
			message({ at: 1100, text: feedbackNote('http://127.0.0.1:1/', 'Make it bigger') }),
			message({ at: 1110, text: answerText(card, 'fix', 'And split it') }),
			message({ at: 1120, text: feedbackNote('http://127.0.0.1:1/', 'Lost'), delivery: 'failed' }),
			message({ at: 1130, text: feedbackNote('http://127.0.0.1:1/', 'Other'), taskId: 'b' })
		];
		const r = taskRuns({ ...base, ledger: ledger([readyAt(1000)]), sent })!;
		expect(r.reworking).toBe(true);
		expect(r.runs[1].startedAt).toBe(iso(1100));
		expect(r.runs[1].basis).toBe(
			'You asked for changes from Wheelhouse after run 1 was reported ready.'
		);
		expect(r.runs[1].changes.map((i) => [i.source, i.kind, i.text, i.state])).toEqual([
			['wheelhouse', 'preview', 'Make it bigger', 'open'],
			['wheelhouse', 'decision', 'And split it', 'open']
		]);

		const later = taskRuns({ ...base, ledger: ledger([readyAt(1000), readyAt(1400)]), sent })!;
		expect(later.reworking).toBe(false);
		expect(later.runs[1].outcome).toBe('ready');
		expect(later.runs[1].changes.map((i) => i.state)).toEqual(['addressed', 'addressed']);
	});

	it('both: says where the changes were asked', () => {
		const r = taskRuns({
			...base,
			ledger: ledger([readyAt(1000)]),
			feedback: feedback({ items: [item({ at: 1100 })] }),
			sent: [message({ at: 1200, text: feedbackNote('http://127.0.0.1:1/', 'x') })]
		})!;
		expect(r.runs[1].basis).toBe(
			'You asked for changes on GitHub and from Wheelhouse after run 1 was reported ready.'
		);
	});

	it('worker: a working line after the ready report starts a run until it reports ready again', () => {
		const r = taskRuns({
			...base,
			ledger: ledger([readyAt(1000), [1100, 'working', 'working on the requested changes']])
		})!;
		expect(r.reworking).toBe(true);
		expect(r.runs[1]).toMatchObject({
			startedAt: iso(1100),
			basis: 'The worker went back to work after run 1 was reported ready.'
		});
		const again = taskRuns({
			...base,
			ledger: ledger([readyAt(1000), [1100, 'working', 'on it'], readyAt(1200)])
		})!;
		expect(again.runs.map((x) => x.outcome)).toEqual(['changes-requested', 'ready']);
		// A note or a pause is not a decisive line.
		expect(
			taskRuns({ ...base, ledger: ledger([readyAt(1000), [1100, 'paused', 'waiting']]) })!.runs
		).toHaveLength(1);
	});
});
