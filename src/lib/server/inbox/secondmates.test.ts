import { describe, expect, it } from 'vitest';
import { parseFleetSnapshot } from '../firstmate/contracts';
import { deriveSecondMates, mateTaskSummaries, secondMateRecords } from '../firstmate/secondmates';
import { buildInbox, type InboxSources } from './cards';
import type { LedgerTask } from '../firstmate/ledger';
import type { TaskSummary } from '../../types';
import { taskSummary } from '../../../../tests/helpers/task-summary';
import { answerText, cardTaskHref, closable, escalated, holdCardId } from '../../inbox';
import {
	mateRecord,
	secondMates,
	snapshotFixture,
	taskRow
} from '../../../../tests/helpers/fake-firstmate';

/*
 * Second mates' questions join the decision inbox as the captain's own
 * workers' do: a captain hold in a second mate's home waits on the captain, a
 * worker's question there is its second mate's to handle first, and the second
 * mate's own question (its row's open decision) is Firstmate's, as any
 * worker's is. Each card names the second mate it comes from.
 */

const snapshot = parseFleetSnapshot(
	JSON.stringify(
		snapshotFixture({
			tasks: [
				taskRow({
					id: 'tokyo',
					kind: 'secondmate',
					decisions: [
						{ key: 'scope', verb: 'needs-decision', summary: 'May I take on the atlas repo too?' }
					]
				})
			],
			secondmate_current: secondMates([
				mateRecord({
					id: 'tokyo',
					remote: true,
					state: 'captain_decision',
					decisions: [
						{
							id: 'tk-plan',
							key: 'tk-plan',
							verb: 'captain-hold',
							summary: 'Pick a plan',
							reason: 'Which storage? Recommendation: approve Postgres.',
							question: 'Pick a plan: Which storage? Recommendation: approve Postgres.',
							source: 'backlog'
						},
						{
							id: 'tk-api',
							key: 'api-shape',
							verb: 'needs-decision',
							summary: 'REST or RPC for the share API?',
							source: 'status'
						}
					],
					queued: [
						{ id: 'tk-plan', title: 'Pick a plan', repo: 'lumen', captain_actionable: true }
					],
					active: [{ id: 'tk-api', name: 'Add the share API', repo: 'lumen', state: 'working' }]
				})
			])
		})
	)
);

const src: InboxSources = {
	tasks: [],
	row: (id) => snapshot.tasks.find((t) => t.id === id) ?? null,
	backlog: () => null,
	ledger: () => null,
	findings: () => null,
	messages: [],
	homeDir: '/fm',
	secondMates: secondMateRecords(snapshot)
};

const cards = buildInbox(src);

describe('second mates in the decision inbox', () => {
	const by = Object.fromEntries(cards.map((c) => [c.id, c]));

	it('fold every question in, labelled with the second mate it comes from', () => {
		expect(cards.map((c) => [c.id, c.kind, c.owner])).toEqual([
			['tokyo:tk-plan:captain-hold', 'hold', 'captain'],
			['tokyo:scope', 'decision', 'firstmate'],
			['tokyo:tk-api:api-shape', 'decision', 'firstmate']
		]);
		for (const c of cards) expect(c.secondMate?.id).toBe('tokyo');
		expect(by['tokyo:tk-plan:captain-hold']).toMatchObject({
			taskId: 'tokyo',
			taskTitle: 'Pick a plan (second mate tokyo)',
			projectId: 'lumen',
			question: 'Pick a plan: Which storage?',
			recommendation: { choice: 'approve' },
			secondMate: { id: 'tokyo', taskId: 'tk-plan', taskTitle: 'Pick a plan' }
		});
		expect(by['tokyo:scope'].secondMate).toEqual({ id: 'tokyo', taskId: null, taskTitle: null });
	});

	it('put a second mate’s captain hold in Your move, and its workers’ questions with it', () => {
		expect(cards.filter(escalated).map((c) => c.id)).toEqual(['tokyo:tk-plan:captain-hold']);
	});

	it('answer through Firstmate about the second mate, naming its task; its home’s never closed from here', () => {
		const hold = by['tokyo:tk-plan:captain-hold'];
		const text = answerText(hold, 'approve', null);
		expect(text).toContain('Task: tokyo (Pick a plan (second mate tokyo))');
		expect(text).toContain(
			'Second mate: tokyo, about its task tk-plan (Pick a plan); pass this answer to that second mate.'
		);
		expect(text).toContain('Decision key: captain-hold');
		expect(closable(by['tokyo:tk-api:api-shape'])).toBe(false);
		expect(closable(hold)).toBe(false);
		// The second mate's own question is the captain's Firstmate's record, as any worker's is.
		expect(closable(by['tokyo:scope'])).toBe(true);
		expect(cardTaskHref(hold)).toBe('/tasks/tk-plan%40tokyo');
		expect(cardTaskHref(by['tokyo:scope'])).toBe('/second-mates#mate-tokyo');
	});
});

describe('a hold Firstmate keeps on a second mate itself', () => {
	const held = buildInbox({
		...src,
		backlog: (id) =>
			id === 'tokyo'
				? {
						...snapshot.tasks[0].backlog!,
						captainActionable: true,
						holdReason: 'Retire tokyo? Recommendation: approve.'
					}
				: null
	});

	it('waits on the captain in Your move, as an ordinary captain hold about the second mate', () => {
		const card = held.find((c) => c.id === holdCardId('tokyo'));
		expect(card).toMatchObject({
			taskId: 'tokyo',
			kind: 'hold',
			key: 'captain-hold',
			owner: 'captain',
			question: 'Retire tokyo?',
			recommendation: { choice: 'approve' },
			secondMate: { id: 'tokyo', taskId: null, taskTitle: null }
		});
		expect(held.filter(escalated).map((c) => c.id)).toEqual([
			'tokyo:captain-hold',
			'tokyo:tk-plan:captain-hold'
		]);
		expect(cardTaskHref(card!)).toBe('/second-mates#mate-tokyo');
	});

	it('is not there without a hold', () => {
		expect(cards.some((c) => c.id === holdCardId('tokyo'))).toBe(false);
	});
});

describe('a second mate’s tasks in the task list', () => {
	it('do not ask their questions twice: the cards are its second mate’s', () => {
		const tasks = deriveSecondMates(snapshot).secondMates.flatMap((m) =>
			mateTaskSummaries(m, { nowSeconds: 1_800_000_000 })
		);
		expect(tasks.some((t) => t.status === 'needs-decision')).toBe(true);
		expect(buildInbox({ ...src, tasks }).map((c) => c.id)).toEqual(
			buildInbox(src).map((c) => c.id)
		);
	});
});

describe('where a second mate’s question can be seen', () => {
	const remote = (id: string, o: Partial<TaskSummary> = {}) =>
		taskSummary(`${id}@tokyo`, 'working', {
			secondMate: { id: 'tokyo', host: 'tokyo', where: 'remote' },
			...o
		});

	it('attaches its task’s preview, checked as that task’s (through its forward)', () => {
		const api = remote('tk-api', {
			preview: { url: 'http://127.0.0.1:5391/', reportedAt: '2026-10-26T07:00:00.000Z' }
		});
		const card = buildInbox({ ...src, tasks: [api] }).find(
			(c) => c.id === 'tokyo:tk-api:api-shape'
		)!;
		expect(card.evidence).toMatchObject({
			preview: 'http://127.0.0.1:5391/',
			previewTask: 'tk-api@tokyo',
			board: null
		});
	});

	it('matches its own question’s preview to the task in its home that reported it', () => {
		const style = remote('tk-style', {
			preview: { url: 'http://127.0.0.1:5391/?style=a', reportedAt: '2026-10-26T07:00:00.000Z' }
		});
		const ledger = (id: string): LedgerTask | null =>
			id === 'tokyo'
				? {
						id: 'tokyo',
						dispatched: null,
						statuses: [],
						prReady: null,
						merged: null,
						cleanedUpAt: null,
						preview: { ts: 1, url: 'http://127.0.0.1:5391/?style=b' },
						board: { ts: 1, url: 'http://127.0.0.1:4387/session/far' },
						runIds: []
					}
				: null;
		const card = buildInbox({ ...src, tasks: [style], ledger }).find(
			(c) => c.id === 'tokyo:scope'
		)!;
		// A remote home's board is on its own loopback, so it is not offered here.
		expect(card.evidence).toMatchObject({
			preview: 'http://127.0.0.1:5391/?style=b',
			previewTask: 'tk-style@tokyo',
			board: null
		});
		// An address no task of the remote home reported cannot be opened from here.
		const none = buildInbox({ ...src, tasks: [], ledger }).find((c) => c.id === 'tokyo:scope')!;
		expect(none.evidence).toMatchObject({ preview: null, previewTask: null, board: null });
	});
});
