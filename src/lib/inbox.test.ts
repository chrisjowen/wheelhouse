import { describe, expect, it } from 'vitest';
import {
	answerOf,
	answerText,
	keyAction,
	openCount,
	optionsFor,
	parseSnoozes,
	visibleCards,
	type InboxCard
} from './inbox';

const card = (o: Partial<InboxCard> = {}): InboxCard => ({
	id: 'demo-export:nm-01J9ZZZZZZZZZZZZZZZZZZZZZZ-review',
	taskId: 'demo-export',
	taskTitle: 'CSV export',
	projectId: 'demo',
	kind: 'review',
	key: 'nm-01J9ZZZZZZZZZZZZZZZZZZZZZZ-review',
	question: 'Should the export include archived rows?',
	askedAt: '2026-10-27T09:00:00Z',
	owner: 'firstmate',
	evidence: {
		text: null,
		findings: [],
		file: null,
		pr: null,
		preview: null,
		checks: null,
		screenshots: []
	},
	options: optionsFor('review'),
	recommendation: null,
	sent: null,
	...o
});

describe('answerText', () => {
	it('names the task, the decision key and the chosen option, with the note', () => {
		const text = answerText(card(), 'fix', '  Leave archived rows out.  ');
		expect(text).toBe(
			[
				'Decision inbox answer (review question).',
				'Task: demo-export (CSV export)',
				'Decision key: nm-01J9ZZZZZZZZZZZZZZZZZZZZZZ-review',
				'Question: Should the export include archived rows?',
				'Answer: Fix - Have the worker fix it.',
				'Note: Leave archived rows out.'
			].join('\n')
		);
	});

	it('names the pull request on a merge call and leaves out an empty note', () => {
		const text = answerText(
			card({
				kind: 'merge',
				key: 'merge-pr',
				options: optionsFor('merge'),
				evidence: { ...card().evidence, pr: { url: 'https://example.test/pull/7', number: 7 } }
			}),
			'approve',
			'   '
		);
		expect(text).toContain('Pull request: https://example.test/pull/7');
		expect(text).toContain('Answer: Approve - Merge the pull request.');
		expect(text).not.toContain('Note:');
	});

	it('reads back as the same key and choice', () => {
		expect(answerOf(answerText(card(), 'skip', 'Later.\nSecond line'))).toEqual({
			key: 'nm-01J9ZZZZZZZZZZZZZZZZZZZZZZ-review',
			question: 'Should the export include archived rows?',
			choice: 'skip',
			note: 'Later.\nSecond line'
		});
		expect(answerOf('Just a chat message')).toBeNull();
	});

	it('labels Fix as Request changes on a preview sign-off, and reads it back', () => {
		const preview = card({ kind: 'preview', key: 'board-review', options: optionsFor('preview') });
		expect(preview.options.map((o) => o.label)).toEqual(['Approve', 'Request changes', 'Skip']);
		const text = answerText(preview, 'fix', null);
		expect(text).toContain('Answer: Request changes - Request changes (say what in a note).');
		expect(answerOf(text)).toMatchObject({ key: 'board-review', choice: 'fix' });
	});
});

describe('ask me later', () => {
	const now = 1_000_000;
	it('keeps only snoozes still in force, and survives bad storage', () => {
		expect(parseSnoozes(JSON.stringify({ a: now + 5, b: now - 5, c: 'x' }), now)).toEqual({
			a: now + 5
		});
		expect(parseSnoozes('{not json', now)).toEqual({});
		expect(parseSnoozes(null, now)).toEqual({});
	});

	it('hides snoozed cards and counts only unanswered ones', () => {
		const a = card({ id: 'a' });
		const b = card({ id: 'b' });
		const c = card({
			id: 'c',
			sent: {
				choice: 'fix',
				note: null,
				at: '',
				delivery: 'delivered',
				detail: null,
				requestId: 'r'
			}
		});
		expect(visibleCards([a, b, c], { b: now + 1 }, now)).toEqual({ shown: [a, c], snoozed: 1 });
		expect(openCount([a, b, c], { b: now + 1 }, now)).toBe(1);
		expect(openCount([a, b, c], { b: now - 1 }, now)).toBe(2);
	});
});

describe('keyboard', () => {
	it('maps j/k, a/f/s, l and Enter', () => {
		expect(keyAction('j')).toEqual({ do: 'move', by: 1 });
		expect(keyAction('k')).toEqual({ do: 'move', by: -1 });
		expect(keyAction('a')).toEqual({ do: 'answer', choice: 'approve' });
		expect(keyAction('f')).toEqual({ do: 'answer', choice: 'fix' });
		expect(keyAction('s')).toEqual({ do: 'answer', choice: 'skip' });
		expect(keyAction('l')).toEqual({ do: 'later' });
		expect(keyAction('Enter')).toEqual({ do: 'evidence' });
		expect(keyAction('x')).toBeNull();
	});
});
