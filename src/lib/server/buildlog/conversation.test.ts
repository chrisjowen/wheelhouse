import { describe, expect, it } from 'vitest';
import { conversation, parseInboxRecord, plainBody, questionCounts } from './conversation';
import type { LedgerStatus } from '../firstmate/ledger';
import type { BridgeMessage, DecisionView } from '../../types';

const T0 = 1_790_000_000;
const st = (ts: number, state: string, text: string, key: string | null = null): LedgerStatus => ({
	ts: T0 + ts,
	state,
	key,
	text
});
const RUN = '01JDABCDEFGHJKMNPQRSTVWXYZ';

describe('inbox records', () => {
	it('reads the body and time of a fm-task-inbox.v1 record', () => {
		const m = parseInboxRecord(
			'001.msg',
			'schema=fm-task-inbox.v1\nat=2026-10-26T09:00:00Z\n--\nUse Pagefind.\nIt needs no service.',
			true
		);
		expect(m).toEqual({
			name: '001.msg',
			at: Date.parse('2026-10-26T09:00:00Z') / 1000,
			body: 'Use Pagefind.\nIt needs no service.',
			handled: true
		});
	});

	it('drops internals and operational instructions from a message', () => {
		expect(
			plainBody(
				'Use Pagefind for search.\n- Keep the index under /Users/x/atlas/dist.\nRun no-mistakes axi respond --run 01JD… when done.'
			)
		).toBe('Use Pagefind for search.\n- Keep the index under');
	});
});

describe('conversation', () => {
	const decided: DecisionView[] = [
		{
			id: `nm-${RUN}-review-${T0 + 100}`,
			taskId: 't',
			taskTitle: 'T',
			projectId: null,
			step: 'review',
			askedAt: '',
			decidedAt: '',
			verdict: 'Fix it',
			calls: [
				{
					question: 'The jittered delay can exceed maxMs.',
					detail: '',
					file: null,
					serious: false,
					verdict: 'Fix it',
					reason: 'Cap it.'
				}
			],
			answerCut: false,
			landed: false
		}
	];

	it('pairs questions with answers and Firstmate’s messages, oldest first', () => {
		const entries = conversation({
			statuses: [
				st(0, 'working', 'starting'),
				st(
					10,
					'needs-decision',
					'Pagefind (static) or Algolia DocSearch (hosted)?',
					'search-engine'
				),
				st(70, 'resolved', 'answered: Pagefind; nothing to run.', 'search-engine'),
				st(
					100,
					'needs-decision',
					`ask-user findings=jitter-cap file=/home/fm/data/t/nm-${RUN}-findings.txt`,
					`nm-${RUN}-review`
				),
				st(200, 'resolved', 'answered: FIX. Cap the jittered delay.', `nm-${RUN}-review`),
				st(300, 'blocked', 'the test database will not start on port 5432')
			],
			inbox: [
				{
					name: '001.msg',
					at: T0 + 65,
					body: 'Pagefind; nothing to run, and it stays in the static build.',
					handled: true
				},
				{
					name: '002.msg',
					at: T0 + 250,
					body: 'Also add a search shortcut on "/".',
					handled: false
				}
			],
			decided,
			captain: [],
			dispatchedAt: T0
		});
		expect(entries.map((e) => [e.kind, e.outcome.state])).toEqual([
			['question', 'answered'],
			['review', 'answered'],
			['steer', 'unread'],
			['blocked', 'open']
		]);
		expect(entries[0]).toMatchObject({
			from: 'worker',
			to: 'firstmate',
			title: 'Pagefind (static) or Algolia DocSearch (hosted)?',
			reply: {
				from: 'firstmate',
				text: 'Pagefind; nothing to run, and it stays in the static build.'
			}
		});
		expect(entries[1].title).toBe('The automated review raised a question for Firstmate');
		expect(entries[1].calls[0]).toMatchObject({ verdict: 'Fix it', reason: 'Cap it.' });
		expect(entries[1].reply).toBeNull();
		expect(entries[2]).toMatchObject({
			from: 'firstmate',
			to: 'worker',
			title: 'Also add a search shortcut on "/".'
		});
		expect(entries[3].title).toBe(
			'The worker was stuck: the test database will not start on port 5432'
		);
		for (const e of entries) expect(JSON.stringify(e)).not.toMatch(/nm-|findings=|\/home\//);
	});

	it('shows the captain’s own messages once, with Firstmate’s reply', () => {
		const m: BridgeMessage = {
			requestId: 'r1',
			text: 'Review feedback on the live preview (http://127.0.0.1:5199/):\nThe share button is hard to find.',
			taskId: 't',
			submittedAt: new Date((T0 + 500) * 1000).toISOString(),
			delivery: 'delivered',
			deliveryDetail: null,
			acknowledged: true,
			noteId: 'n1',
			reply: { body: 'Passed to the worker.', at: null }
		};
		const entries = conversation({
			statuses: [],
			inbox: [
				{
					name: '003.msg',
					at: T0 + 520,
					body: 'Captain feedback: The share button is hard to find. Move it to the album header.',
					handled: true
				}
			],
			decided: [],
			captain: [m],
			dispatchedAt: T0
		});
		expect(entries).toHaveLength(1);
		expect(entries[0]).toMatchObject({
			kind: 'captain',
			title: 'You sent feedback from the live preview',
			body: 'The share button is hard to find.',
			reply: { text: 'Passed to the worker.' },
			outcome: { label: 'Firstmate has it' }
		});
	});
});

describe('question counts', () => {
	it('counts each keyed question once and what is still open', () => {
		expect(
			questionCounts([
				st(1, 'needs-decision', 'a?', 'k1'),
				st(2, 'needs-decision', 'a again?', 'k1'),
				st(3, 'resolved', 'answered: yes', 'k1'),
				st(4, 'blocked', 'stuck'),
				st(5, 'needs-decision', 'b?', 'k2'),
				st(6, 'needs-decision', `ask-user findings=x,y file=/f.txt`, `nm-${RUN}-review`)
			])
		).toEqual({ questions: 5, open: 4 });
	});
});
