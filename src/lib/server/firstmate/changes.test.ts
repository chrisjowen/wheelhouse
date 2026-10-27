import { describe, expect, it } from 'vitest';
import {
	addressingReview,
	changeRequests,
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
	commitId: 'h1',
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
const changes = (at: number, commitId = 'h1') =>
	item({ kind: 'review', state: 'CHANGES_REQUESTED', at, commitId, path: null, line: null });

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

describe('addressingReview', () => {
	const READY = 1000;

	it('is false without a ready report or without feedback', () => {
		expect(addressingReview(null, feedback({ items: [changes(1100)] }))).toBe(false);
		expect(addressingReview(READY, null)).toBe(false);
		expect(addressingReview(READY, feedback())).toBe(false);
	});

	it('is true after a review, a thread or a PR comment following the ready report', () => {
		expect(addressingReview(READY, feedback({ items: [changes(1100)] }))).toBe(true);
		expect(addressingReview(READY, feedback({ items: [item({ at: 1200 })] }))).toBe(true);
		expect(
			addressingReview(
				READY,
				feedback({ items: [item({ at: 1200, kind: 'comment', commitId: null })] })
			)
		).toBe(true);
	});

	it('is true when new commits landed after the ready report', () => {
		expect(addressingReview(READY, feedback({ head: head('h2', 1050) }))).toBe(true);
	});

	it('ignores resolved threads', () => {
		expect(addressingReview(READY, feedback({ items: [item({ at: 1200, resolved: true })] }))).toBe(
			false
		);
	});

	it('clears only with a newer ready report for a newer head', () => {
		// The review was on h1; the worker pushed h2 and reported ready again at 1300.
		expect(
			addressingReview(1300, feedback({ head: head('h2', 1250), items: [changes(1100, 'h1')] }))
		).toBe(false);
		// A newer ready report without a new head does not clear it.
		expect(addressingReview(1300, feedback({ items: [changes(1100, 'h1')] }))).toBe(true);
		// Nor does a new head without a newer ready report.
		expect(
			addressingReview(READY, feedback({ head: head('h2', 1250), items: [changes(1100, 'h1')] }))
		).toBe(true);
	});
});

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

	it('leaves other messages alone', () => {
		expect(wheelhouseRequest(message({ at: 1, text: 'How is it going?' }))).toBeNull();
		expect(
			wheelhouseRequest(message({ at: 1, text: answerText(card, 'approve', null) }))
		).toBeNull();
	});
});

describe('changeRequests', () => {
	const base = { prUrl: PR, taskId: 'a', sent: [] as BridgeMessage[], feedback: null };

	it('is null before the PR was ever reported ready', () => {
		expect(
			changeRequests({ ...base, ledger: ledger([[900, 'working', 'x']]), feedback: feedback() })
		).toBeNull();
		expect(changeRequests({ ...base, ledger: ledger([readyAt(1000)]) })).toBeNull();
	});

	it('GitHub: a review thread after the ready report hands the PR to the worker, with the file and line', () => {
		const c = changeRequests({
			...base,
			ledger: ledger([readyAt(1000)]),
			feedback: feedback({ items: [item({ at: 1100 })] })
		})!;
		expect(c.active).toBe(true);
		expect(c.since).toBe(iso(1100));
		expect(c.basis).toBe('You asked for changes on GitHub after it was reported ready.');
		expect(c.items).toEqual([
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
		const c = changeRequests({
			...base,
			ledger: ledger([readyAt(1000)]),
			feedback: feedback({ items: [changes(1100)].map((x) => ({ ...x, text: '' })) })
		})!;
		expect(c.items[0].text).toBe('Changes requested.');
	});

	it('GitHub: back to the captain once the worker pushes and reports ready again; history stays', () => {
		const c = changeRequests({
			...base,
			ledger: ledger([readyAt(1000), [1150, 'working', 'addressing review'], readyAt(1300)]),
			feedback: feedback({
				head: head('h2', 1250),
				items: [item({ at: 1100 }), item({ at: 1120, id: 't2', resolved: true })]
			})
		})!;
		expect(c.active).toBe(false);
		expect(c.basis).toBeNull();
		expect(c.items.map((i) => i.state)).toEqual(['addressed', 'resolved']);
	});

	it('GitHub: a merged or closed PR is nobody’s turn', () => {
		const c = changeRequests({
			...base,
			ledger: ledger([readyAt(1000)]),
			feedback: feedback({ state: 'merged', items: [item({ at: 1100 })] })
		})!;
		expect(c.active).toBe(false);
	});

	it('GitHub: new commits alone say so', () => {
		const c = changeRequests({
			...base,
			ledger: ledger([readyAt(1000)]),
			feedback: feedback({ head: head('h2', 1100) })
		})!;
		expect(c.active).toBe(true);
		expect(c.basis).toBe('New commits were pushed after it was reported ready.');
		expect(c.items).toEqual([]);
	});

	it('Wheelhouse: preview feedback or a Decisions Fix after the ready report hands it to the worker', () => {
		const sent = [
			message({ at: 900, text: feedbackNote('http://127.0.0.1:1/', 'Before the PR') }),
			message({ at: 1100, text: feedbackNote('http://127.0.0.1:1/', 'Make it bigger') }),
			message({ at: 1110, text: answerText(card, 'fix', 'And split it') }),
			message({ at: 1120, text: feedbackNote('http://127.0.0.1:1/', 'Lost'), delivery: 'failed' }),
			message({ at: 1130, text: feedbackNote('http://127.0.0.1:1/', 'Other'), taskId: 'b' })
		];
		const c = changeRequests({ ...base, ledger: ledger([readyAt(1000)]), sent })!;
		expect(c.active).toBe(true);
		expect(c.since).toBe(iso(1100));
		expect(c.basis).toBe('You asked for changes from Wheelhouse after it was reported ready.');
		expect(c.items.map((i) => [i.source, i.kind, i.text, i.state])).toEqual([
			['wheelhouse', 'preview', 'Make it bigger', 'open'],
			['wheelhouse', 'decision', 'And split it', 'open']
		]);

		const later = changeRequests({
			...base,
			ledger: ledger([readyAt(1000), readyAt(1400)]),
			sent
		})!;
		expect(later.active).toBe(false);
		expect(later.items.map((i) => i.state)).toEqual(['addressed', 'addressed']);
	});

	it('both: says where the changes were asked', () => {
		const c = changeRequests({
			...base,
			ledger: ledger([readyAt(1000)]),
			feedback: feedback({ items: [item({ at: 1100 })] }),
			sent: [message({ at: 1200, text: feedbackNote('http://127.0.0.1:1/', 'x') })]
		})!;
		expect(c.basis).toBe(
			'You asked for changes on GitHub and from Wheelhouse after it was reported ready.'
		);
	});

	it('worker: a working line after the ready report is the worker’s turn until it reports ready again', () => {
		const c = changeRequests({
			...base,
			ledger: ledger([readyAt(1000), [1100, 'working', 'working on the requested changes']])
		})!;
		expect(c.active).toBe(true);
		expect(c.since).toBe(iso(1100));
		expect(c.basis).toBe('The worker is working on it again after it was reported ready.');
		expect(
			changeRequests({
				...base,
				ledger: ledger([readyAt(1000), [1100, 'working', 'on it'], readyAt(1200)])
			})
		).toBeNull();
		// A note or a pause is not a decisive line.
		expect(
			changeRequests({ ...base, ledger: ledger([readyAt(1000), [1100, 'paused', 'waiting']]) })
		).toBeNull();
	});
});
