import { describe, expect, it } from 'vitest';
import { optionsFor, type AnsweredDecision, type InboxCard } from '../inbox';
import { chatDecisions, placeDecisions, type ChatDecision } from './decisions';
import type { Item } from './fold';

const T = Date.parse('2026-10-31T09:00:00.000Z');
const iso = (min: number) => new Date(T + min * 60_000).toISOString();

function card(id: string, min: number | null, o: Partial<InboxCard> = {}): InboxCard {
	const [taskId, key] = id.split(':');
	return {
		id,
		taskId,
		taskTitle: `Task ${taskId}`,
		projectId: 'lumen',
		kind: 'decision',
		key,
		question: `Question on ${taskId}?`,
		askedAt: min === null ? null : iso(min),
		owner: 'captain',
		evidence: {
			text: null,
			report: null,
			findings: [],
			file: null,
			pr: null,
			preview: null,
			checks: null,
			screenshots: []
		},
		options: optionsFor('decision'),
		recommendation: null,
		choices: null,
		sent: null,
		...o
	};
}

function logged(c: InboxCard, requestId: string, min: number): AnsweredDecision {
	return {
		requestId,
		cardId: c.id,
		taskId: c.taskId,
		taskTitle: c.taskTitle,
		projectId: c.projectId,
		kind: c.kind,
		key: c.key,
		question: c.question,
		askedAt: c.askedAt,
		choice: 'approve',
		label: 'Approve',
		picks: null,
		note: 'Go.',
		answeredAt: iso(min),
		delivery: 'delivered'
	};
}

const sent = (requestId: string, min: number): NonNullable<InboxCard['sent']> => ({
	choice: 'fix',
	picks: null,
	note: 'Change it.',
	at: iso(min),
	delivery: 'delivered',
	detail: null,
	requestId
});

describe('chatDecisions', () => {
	it('shows an open card open, and folds one answered here, one sent, and one answered before', () => {
		const open = card('a:k', 1);
		const mine = card('b:k', 2);
		const withSent = card('c:k', 3, { sent: sent('inbox-c', 4) });
		const gone = card('d:k', 0);
		const ds = chatDecisions(
			[open, mine, withSent],
			[logged(withSent, 'inbox-c', 4), logged(gone, 'inbox-d', 1)],
			{ 'b:k': { choice: 'skip', picks: null, note: null, question: mine.question, posted: false } }
		);
		expect(ds.map((d) => [d.id, d.answer?.label ?? null, d.answer?.delivery ?? null])).toEqual([
			['a:k', null, null],
			['b:k', 'Skip', 'sending'],
			['c:k', 'Fix', 'delivered'],
			['answer:inbox-d', 'Approve', 'delivered']
		]);
		expect(ds[3]).toMatchObject({ card: null, head: { cardId: 'd:k', question: gone.question } });
	});

	it('keeps a card whose answer failed open, and an answer this browser sent to an older question out of it', () => {
		const failed = card('a:k', 1, { sent: { ...sent('inbox-a', 2), delivery: 'failed' } });
		const changed = card('b:k', 1);
		const ds = chatDecisions([failed, changed], [], {
			'b:k': {
				choice: 'approve',
				picks: null,
				note: null,
				question: 'An older question?',
				posted: true
			}
		});
		expect(ds.map((d) => d.answer)).toEqual([null, null]);
	});

	it('shows an earlier answer to a different question on the same card beside the new card', () => {
		const again = card('a:k', 10);
		const old = card('a:k', 1, { question: 'An older question?' });
		const ds = chatDecisions([again], [logged(old, 'inbox-old', 2)], {});
		expect(ds.map((d) => d.id)).toEqual(['a:k', 'answer:inbox-old']);
	});

	it('shows a question once, open, when its logged answer later failed', () => {
		const c = card('a:k', 1, { sent: { ...sent('inbox-a', 2), delivery: 'failed' } });
		const ds = chatDecisions([c], [{ ...logged(c, 'inbox-a', 2), delivery: 'failed' }], {});
		expect(ds.map((d) => [d.id, d.answer])).toEqual([['a:k', null]]);
		const gone = chatDecisions([], [{ ...logged(c, 'inbox-a', 2), delivery: 'failed' }], {});
		expect(gone).toEqual([]);
	});

	it('leaves out a logged answer to the same question while its card is still open', () => {
		const c = card('a:k', 1);
		const ds = chatDecisions([c], [{ ...logged(c, 'inbox-a', 2), delivery: 'uncertain' }], {});
		expect(ds.map((d) => [d.id, d.answer])).toEqual([['a:k', null]]);
	});

	it('does not claim Firstmate has an answer this browser posted until the inbox says so', () => {
		const c = card('a:k', 1);
		const ds = chatDecisions([c], [], {
			'a:k': { choice: 'approve', picks: null, note: null, question: c.question, posted: true }
		});
		expect(ds[0].answer?.delivery).toBeNull();
		const taken = { ...c, sent: { ...sent('inbox-a', 2), choice: 'approve' as const } };
		const later = chatDecisions([taken], [], {
			'a:k': { choice: 'approve', picks: null, note: null, question: c.question, posted: true }
		});
		expect(later[0].answer?.delivery).toBe('delivered');
	});
});

describe('placeDecisions', () => {
	const item = (id: string, min: number): Item => ({
		kind: 'user',
		id,
		text: id,
		at: iso(min),
		queued: false,
		command: false
	});
	const d = (id: string, asked: number | null, answered: number | null = null): ChatDecision => ({
		id,
		head: {
			cardId: id,
			taskId: id,
			taskTitle: id,
			projectId: null,
			kind: 'decision',
			key: 'k',
			question: '?',
			askedAt: asked === null ? null : iso(asked)
		},
		card: null,
		answer:
			answered === null
				? null
				: {
						choice: 'approve',
						label: 'Approve',
						picks: null,
						note: null,
						at: iso(answered),
						delivery: null
					}
	});

	it('puts each decision before the first message after it was asked, the newest after them all', () => {
		const items = [item('m0', 0), item('m1', 10), item('m2', 20)];
		const { before, end } = placeDecisions(items, [
			d('late', 25),
			d('mid', 15),
			d('early', 5),
			d('mid2', 12)
		]);
		expect([...before.entries()].map(([i, ds]) => [i, ds.map((x) => x.id)])).toEqual([
			[1, ['early']],
			[2, ['mid2', 'mid']]
		]);
		expect(end.map((x) => x.id)).toEqual(['late']);
	});

	it('places one asked at an unknown time when it was answered, else last', () => {
		const items = [item('m0', 0), item('m1', 10)];
		const { before, end } = placeDecisions(items, [d('unknown', null), d('answered', null, 5)]);
		expect(before.get(1)?.map((x) => x.id)).toEqual(['answered']);
		expect(end.map((x) => x.id)).toEqual(['unknown']);
	});

	it('keeps a question still in the inbox first once it is answered, with its thread', () => {
		const items = [item('m0', 10)];
		const inInbox = { ...d('answered-here', 1, 12), card: card('answered-here:k', 1) };
		const { before } = placeDecisions(items, [inInbox, d('log-only', 1, 2)]);
		expect(before.get(0)?.map((x) => x.id)).toEqual(['answered-here']);
		expect(placeDecisions([], [inInbox]).end.map((x) => x.id)).toEqual(['answered-here']);
	});

	it('leaves out answers older than the conversation, but shows open questions first', () => {
		const items = [item('m0', 10)];
		const { before, end } = placeDecisions(items, [d('old-answered', 1, 2), d('old-open', 1)]);
		expect(before.get(0)?.map((x) => x.id)).toEqual(['old-open']);
		expect(end).toEqual([]);
		expect(placeDecisions([], [d('open', 1), d('answered', 1, 2)]).end.map((x) => x.id)).toEqual([
			'open'
		]);
	});
});
