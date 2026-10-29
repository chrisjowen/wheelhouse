import { describe, expect, it } from 'vitest';
import {
	answerOf,
	answerText,
	closable,
	closeText,
	keyAction,
	openCount,
	optionsFor,
	parseSnoozes,
	picksLine,
	unpicked,
	visibleCards,
	type InboxCard,
	type InboxChoices
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
		report: null,
		findings: [],
		file: null,
		pr: null,
		preview: null,
		checks: null,
		screenshots: []
	},
	options: optionsFor('review'),
	recommendation: null,
	choices: null,
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
			picks: null,
			note: 'Later.\nSecond line'
		});
		expect(answerOf('Just a chat message')).toBeNull();
	});

	it('sends the picks on a card with choices, and reads them back', () => {
		const choices: InboxChoices = {
			intro: 'Gateway design calls',
			after: null,
			calls: [
				{
					id: '1',
					number: 1,
					prompt: 'Approach',
					required: true,
					options: [
						{ id: 'A', label: 'A', detail: 'core gateway with bot adapters', recommended: true },
						{ id: 'C', label: 'C', detail: 'Claude Code channels only', recommended: false }
					]
				},
				{
					id: '2',
					number: 2,
					prompt: 'First channel',
					required: true,
					options: [
						{ id: '1', label: 'Discord', detail: null, recommended: false },
						{ id: '2', label: 'Telegram', detail: null, recommended: false }
					]
				},
				{ id: '3', number: 3, prompt: 'Budget', required: false, options: [] },
				{
					id: 'then-1',
					number: null,
					prompt: 'If A: should new issues also ring the bell?',
					required: false,
					options: [
						{ id: 'yes', label: 'Yes', detail: null, recommended: false },
						{ id: 'no', label: 'No', detail: null, recommended: false }
					]
				}
			]
		};
		const hold = card({
			kind: 'hold',
			key: 'captain-hold',
			options: optionsFor('hold', true),
			choices
		});
		expect(hold.options[0]).toMatchObject({ choice: 'approve', label: 'Send picks' });
		// The recommended pick fills a call the captain left; a required call without one blocks.
		expect(unpicked(choices, {}).map((c) => c.id)).toEqual(['2']);
		expect(picksLine(choices, {})).toEqual({
			ok: false,
			error: 'Pick an option for 2) First channel.'
		});
		expect(picksLine(choices, { '2': '9' })).toMatchObject({ ok: false });
		expect(picksLine(choices, { '7': '1', '2': '1' })).toMatchObject({ ok: false });
		const line = picksLine(choices, { '2': '1', '3': ' under £50 ', 'then-1': 'yes' });
		expect(line).toEqual({
			ok: true,
			line: '1) Approach: A (core gateway with bot adapters)  2) First channel: Discord  3) Budget: under £50  If A: should new issues also ring the bell? Yes'
		});
		const text = answerText(hold, 'approve', 'Ship it', line.ok ? line.line : null);
		expect(text).toContain('Answer: Send picks - Go ahead with the picks below.');
		expect(answerOf(text)).toMatchObject({
			key: 'captain-hold',
			choice: 'approve',
			picks: line.ok ? line.line : null,
			note: 'Ship it'
		});
	});

	it('names an unnamed lettered call "this question" in its errors', () => {
		const choices: InboxChoices = {
			intro: '',
			calls: [
				{
					id: 'main',
					number: null,
					prompt: null,
					required: true,
					options: [
						{ id: 'A', label: 'A', detail: 'flat', recommended: false },
						{ id: 'B', label: 'B', detail: 'nested', recommended: false }
					]
				}
			],
			after: null
		};
		expect(picksLine(choices, {})).toEqual({
			ok: false,
			error: 'Pick an option for this question.'
		});
		expect(picksLine(choices, { main: 'Z' })).toEqual({
			ok: false,
			error: 'That is not an option for this question.'
		});
		expect(picksLine(choices, { main: 'B' })).toEqual({ ok: true, line: 'B (nested)' });
	});

	it('labels Fix as Request changes on a preview sign-off, and reads it back', () => {
		const preview = card({ kind: 'preview', key: 'board-review', options: optionsFor('preview') });
		expect(preview.options.map((o) => o.label)).toEqual(['Approve', 'Request changes', 'Skip']);
		const text = answerText(preview, 'fix', null);
		expect(text).toContain('Answer: Request changes - Request changes (say what in a note).');
		expect(answerOf(text)).toMatchObject({ key: 'board-review', choice: 'fix' });
	});
});

describe('closeText', () => {
	it('asks Firstmate to close the decision on its key, with the note', () => {
		const text = closeText(card(), '  Settled in chat.  ');
		expect(text).toBe(
			[
				'Decision inbox close (review question).',
				'Task: demo-export (CSV export)',
				'Decision key: nm-01J9ZZZZZZZZZZZZZZZZZZZZZZ-review',
				'Question: Should the export include archived rows?',
				'Close: The captain closed this question without choosing an answer. Record it resolved on key nm-01J9ZZZZZZZZZZZZZZZZZZZZZZ-review so it leaves the open decisions, and settle anything the worker still waits for under your own rules.',
				'Note: Settled in chat.'
			].join('\n')
		);
	});

	it('reads back as a close on the same key and question', () => {
		expect(answerOf(closeText(card(), null))).toEqual({
			key: 'nm-01J9ZZZZZZZZZZZZZZZZZZZZZZ-review',
			question: 'Should the export include archived rows?',
			choice: 'close',
			note: null
		});
	});

	it('closes only questions Firstmate keeps under a decision key', () => {
		expect(closable(card())).toBe(true);
		expect(closable(card({ kind: 'decision' }))).toBe(true);
		expect(closable(card({ kind: 'blocked' }))).toBe(true);
		expect(closable(card({ kind: 'preview' }))).toBe(true);
		expect(closable(card({ kind: 'hold', key: 'captain-hold' }))).toBe(false);
		expect(closable(card({ kind: 'merge', key: 'merge-pr' }))).toBe(false);
		expect(closable(card({ kind: 'decision', key: 'open-1' }))).toBe(false);
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
				picks: null,
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
	it('maps j/k, a/f/s, l, c and Enter', () => {
		expect(keyAction('j')).toEqual({ do: 'move', by: 1 });
		expect(keyAction('k')).toEqual({ do: 'move', by: -1 });
		expect(keyAction('a')).toEqual({ do: 'answer', choice: 'approve' });
		expect(keyAction('f')).toEqual({ do: 'answer', choice: 'fix' });
		expect(keyAction('s')).toEqual({ do: 'answer', choice: 'skip' });
		expect(keyAction('l')).toEqual({ do: 'later' });
		expect(keyAction('c')).toEqual({ do: 'close' });
		expect(keyAction('Enter')).toEqual({ do: 'evidence' });
		expect(keyAction('x')).toBeNull();
	});
});
