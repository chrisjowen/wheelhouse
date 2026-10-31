import { describe, expect, it } from 'vitest';
import { discussText, parseDiscuss, pendingThreads, threads } from './discuss';
import type { Item, Part } from './fold';
import type { Pending } from './outbox';

const REF = {
	taskId: 'lumen-pricing',
	key: 'layout',
	question: 'Which pricing layout should ship?'
};

const user = (id: string, text: string): Item => ({
	kind: 'user',
	id,
	text,
	at: '2026-10-31T09:00:00.000Z',
	queued: false,
	command: false
});
const turn = (
	id: string,
	parts: Part[],
	o: { done?: boolean; background?: boolean } = {}
): Item => ({
	kind: 'turn',
	id,
	parts,
	at: '2026-10-31T09:00:05.000Z',
	durationMs: null,
	done: o.done ?? true,
	interrupted: false,
	trigger: o.background ? 'background' : 'captain'
});
const text = (id: string, t: string): Part => ({ kind: 'text', id, text: t });

describe('discussText and parseDiscuss', () => {
	it('quotes the task, key and question before the words, and reads them back', () => {
		const t = discussText(REF, '  What’s the risk?  ');
		expect(t).toBe(
			'> About the decision on lumen-pricing (key layout), not an answer yet: “Which pricing layout should ship?”\n\nWhat’s the risk?'
		);
		expect(parseDiscuss(t)).toEqual({ cardId: 'lumen-pricing:layout', body: 'What’s the risk?' });
	});

	it('sends nothing without words, or for a task or key it could not read back', () => {
		expect(discussText(REF, '   ')).toBe('');
		expect(discussText({ ...REF, key: 'two words' }, 'Why?')).toBe('');
		expect(discussText({ ...REF, taskId: 'a(b)' }, 'Why?')).toBe('');
	});

	it('cuts a long question to one quoted line', () => {
		const t = discussText({ ...REF, question: `Pick one:\n${'word '.repeat(60)}` }, 'Hm?');
		expect(t.split('\n')[0].length).toBeLessThan(220);
		expect(parseDiscuss(t)?.body).toBe('Hm?');
	});

	it('is not fooled by an ordinary message or a reply quote', () => {
		expect(parseDiscuss('What about the pricing layout?')).toBeNull();
		expect(parseDiscuss('> Replying to Firstmate: “Shall I merge it?”\n\nYes')).toBeNull();
	});
});

describe('threads', () => {
	const ask = discussText(REF, 'What’s the risk?');

	it('moves a question and the reply Firstmate started after it into the decision’s thread', () => {
		const items = [
			user('u0', 'Morning'),
			turn('t0', [text('t0-a', 'Morning, Captain.')]),
			user('u1', ask),
			turn('t1', [{ kind: 'activity', id: 't1-a', steps: [] }, text('t1-b', 'Low risk.')]),
			user('u2', 'Thanks')
		];
		const { byCard, hidden } = threads(items, new Set(['lumen-pricing:layout']));
		expect([...hidden]).toEqual(['u1', 't1']);
		expect(byCard.get('lumen-pricing:layout')).toEqual({
			messages: [
				{ id: 'u1', who: 'captain', text: 'What’s the risk?', at: items[2].at },
				{ id: 't1-b', who: 'firstmate', text: 'Low risk.', at: items[3].at }
			],
			answering: false
		});
	});

	it('says Firstmate is still answering while the reply’s turn is open', () => {
		const { byCard } = threads(
			[user('u1', ask), turn('t1', [], { done: false })],
			new Set(['lumen-pricing:layout'])
		);
		expect(byCard.get('lumen-pricing:layout')?.answering).toBe(true);
	});

	it('leaves in the conversation a question about a decision not shown, a background turn, and a reply that asks something', () => {
		const items = [
			user('u1', ask),
			turn('t1', [text('t1-a', 'All quiet.')], { background: true }),
			user('u2', ask),
			turn('t2', [{ kind: 'question', id: 'q', questions: [], answers: null }])
		];
		expect([...threads(items, new Set()).hidden]).toEqual([]);
		const { hidden, byCard } = threads(items, new Set(['lumen-pricing:layout']));
		expect([...hidden]).toEqual(['u1', 'u2']);
		expect(byCard.get('lumen-pricing:layout')?.messages.map((m) => m.id)).toEqual(['u1', 'u2']);
	});
});

describe('pendingThreads', () => {
	it('groups questions still on their way by card, leaving other messages out', () => {
		const p = (id: string, t: string): Pending => ({
			id,
			text: t,
			via: 'session',
			state: 'sending',
			error: null,
			after: null
		});
		const m = pendingThreads([p('a', discussText(REF, 'Why?')), p('b', 'Hello')]);
		expect([...m.keys()]).toEqual(['lumen-pricing:layout']);
		expect(m.get('lumen-pricing:layout')?.map((x) => x.body)).toEqual(['Why?']);
	});
});
