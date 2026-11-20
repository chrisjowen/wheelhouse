import { describe, expect, it } from 'vitest';
import {
	ANSWER_GRACE_MS,
	answerStale,
	answered,
	awaitsAnswer,
	inboxSignal,
	answerOf,
	answerText,
	closeText,
	escalated,
	followKey,
	followingFor,
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
	title: 'Should the export include archived rows?',
	origin: null,
	following: null,
	askedAt: '2026-10-27T09:00:00Z',
	owner: 'firstmate',
	evidence: {
		text: null,
		report: null,
		findings: [],
		file: null,
		pr: null,
		preview: null,
		previewTask: null,
		board: null,
		checks: null,
		screenshots: [],
		docs: []
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

	it('names calls by their tags, and sends only the calls picked when partial', () => {
		const call = (id: string, rec: string, key = false) => ({
			id,
			number: null,
			prompt: `Question ${id}?`,
			required: true,
			tag: id,
			key,
			why: null,
			options: ['a', 'b'].map((o) => ({
				id: o,
				label: o,
				detail: `${id} option ${o}`,
				recommended: o === rec
			}))
		});
		const choices: InboxChoices = {
			intro: 'Nine calls.',
			calls: [call('D1', 'a', true), call('D2', 'a'), call('D3', 'b')],
			after: null
		};
		// Whole: the recommendation fills each call left.
		expect(picksLine(choices, { D2: 'b' })).toEqual({
			ok: true,
			line: 'D1) Question D1? a (D1 option a)  D2) Question D2? b (D2 option b)  D3) Question D3? b (D3 option b)'
		});
		// Partial: only the calls picked, the rest named as still open.
		const part = picksLine(choices, { D2: 'b' }, { partial: true });
		expect(part).toEqual({
			ok: true,
			line: 'D2) Question D2? b (D2 option b)  Still open: D1, D3'
		});
		expect(picksLine(choices, {}, { partial: true })).toEqual({
			ok: false,
			error: 'Make a pick first.'
		});
		const hold = card({
			kind: 'hold',
			key: 'trust-calls',
			options: optionsFor('hold', true),
			choices
		});
		const text = answerText(hold, 'approve', null, part.ok ? part.line : null, null, true);
		expect(text).toContain('Partial: The captain answered only the calls above.');
		expect(text).toContain('hold it again with those calls only');
		expect(answerOf(text)).toMatchObject({ key: 'trust-calls', picks: part.ok ? part.line : null });
		expect(answerText(hold, 'approve', null, part.ok ? part.line : null)).not.toContain('Partial:');
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
	it('asks Firstmate to resolve a dismissed decision on its key, with the reason', () => {
		const text = closeText(card(), '  Settled in chat.  ');
		expect(text).toBe(
			[
				'Decision inbox dismiss (review question).',
				'Task: demo-export (CSV export)',
				'Decision key: nm-01J9ZZZZZZZZZZZZZZZZZZZZZZ-review',
				'Question: Should the export include archived rows?',
				'Dismiss: The captain dismissed this question without choosing an answer. Record it resolved on key nm-01J9ZZZZZZZZZZZZZZZZZZZZZZ-review so it leaves the open decisions, and settle anything the work still waits for under your own rules.',
				'Reason: Settled in chat.'
			].join('\n')
		);
	});

	it('asks Firstmate to close a held task as dismissed, not answered', () => {
		const text = closeText(
			card({ kind: 'hold', key: 'fm-inbox-fix-call', taskId: 'fm-inbox-fix-call' }),
			'Already sorted elsewhere'
		);
		expect(text).toContain('Decision key: fm-inbox-fix-call');
		expect(text).toContain(
			'Close the held task fm-inbox-fix-call as dismissed (not answered), record the reason below'
		);
		expect(text).toContain('Reason: Already sorted elsewhere');
	});

	it('dismisses a merge call and a question without a key in their own words', () => {
		expect(closeText(card({ kind: 'merge', key: 'merge-pr' }), null)).toContain(
			'leave the pull request unmerged'
		);
		expect(closeText(card({ kind: 'decision', key: 'open-1' }), null)).toContain(
			'Record it closed so it leaves the open decisions'
		);
	});

	it('reads back as a dismissal on the same key and question, the reason as its note', () => {
		expect(answerOf(closeText(card(), 'Wrong question'))).toEqual({
			key: 'nm-01J9ZZZZZZZZZZZZZZZZZZZZZZ-review',
			question: 'Should the export include archived rows?',
			choice: 'close',
			picks: null,
			note: 'Wrong question'
		});
	});

	it('still reads a close sent before Dismiss as a dismissal', () => {
		const old = [
			'Decision inbox close (review question).',
			'Task: demo-export (CSV export)',
			'Decision key: k1',
			'Question: Q?',
			'Close: The captain closed this question without choosing an answer.',
			'Note: Settled in chat.'
		].join('\n');
		expect(answerOf(old)).toMatchObject({ key: 'k1', choice: 'close', note: 'Settled in chat.' });
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
		const a = card({ id: 'a', owner: 'captain' });
		const b = card({ id: 'b', owner: 'captain' });
		const c = card({
			id: 'c',
			owner: 'captain',
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
		// An answered card is gone, snoozed or not.
		expect(visibleCards([a, b, c], { b: now + 1 }, now)).toEqual({ shown: [a], snoozed: 1 });
		expect(visibleCards([a, b, c], { b: now + 1, c: now + 1 }, now)).toEqual({
			shown: [a],
			snoozed: 1
		});
		expect(openCount([a, b, c], { b: now + 1 }, now)).toBe(1);
		expect(openCount([a, b, c], { b: now - 1 }, now)).toBe(2);
	});

	it('counts only what Firstmate escalated to the captain', () => {
		const mine = card({ id: 'mine', owner: 'captain' });
		const theirs = card({ id: 'theirs', owner: 'firstmate' });
		expect(escalated(mine)).toBe(true);
		expect(escalated(theirs)).toBe(false);
		expect(openCount([mine, theirs], {}, now)).toBe(1);
	});
});

describe('an answer Firstmate has not closed yet', () => {
	const now = Date.parse('2026-10-27T12:00:00Z');
	const sentAt = (msAgo: number, delivery = 'delivered'): InboxCard['sent'] => ({
		choice: 'approve',
		picks: null,
		note: null,
		at: new Date(now - msAgo).toISOString(),
		delivery,
		detail: null,
		requestId: 'r'
	});
	const open = card({ id: 'open', owner: 'captain' });
	const fresh = card({ id: 'fresh', owner: 'captain', sent: sentAt(60_000) });
	const stale = card({ id: 'stale', owner: 'captain', sent: sentAt(ANSWER_GRACE_MS + 60_000) });
	const failed = card({
		id: 'failed',
		owner: 'captain',
		sent: sentAt(ANSWER_GRACE_MS + 60_000, 'failed')
	});

	it('tells a question still open long after its answer from one just answered', () => {
		expect([open, fresh, stale, failed].map((c) => answered(c))).toEqual([
			false,
			true,
			true,
			false
		]);
		expect([open, fresh, stale, failed].map((c) => answerStale(c, now))).toEqual([
			false,
			false,
			true,
			false
		]);
		expect([open, fresh, stale, failed].map((c) => awaitsAnswer(c, now))).toEqual([
			true,
			false,
			true,
			true
		]);
		// An answer with no readable time never counts as left open.
		expect(answerStale(card({ sent: { ...stale.sent!, at: '' } }), now)).toBe(false);
	});

	it('shows it again, but does not count it as waiting on the captain', () => {
		expect(visibleCards([open, fresh, stale, failed], {}, now).shown.map((c) => c.id)).toEqual([
			'open',
			'stale',
			'failed'
		]);
		expect(openCount([open, fresh, stale, failed], {}, now)).toBe(2);
	});
});

describe('following up a decision', () => {
	it('is kept per task, and per task in a second mate’s home', () => {
		expect(followKey({ taskId: 'demo-billing' })).toBe('demo-billing');
		const mate = { id: 'sm-1', taskId: null, taskTitle: null };
		expect(followKey({ taskId: 'sm-1', secondMate: mate })).toBe('sm-1');
		expect(followKey({ taskId: 'sm-1', secondMate: { ...mate, taskId: 'a' } })).toBe('a@sm-1');
		expect(followKey({ taskId: 'sm-1', secondMate: { ...mate, taskId: 'b' } })).toBe('b@sm-1');
	});

	it('covers only questions asked before it started', () => {
		const at = '2026-11-15T10:00:00.000Z';
		expect(followingFor(at, '2026-11-15T09:00:00.000Z')).toBe(at);
		expect(followingFor(at, null)).toBe(at);
		expect(followingFor(at, '2026-11-15T11:00:00.000Z')).toBeNull();
		expect(followingFor(null, null)).toBeNull();
	});
});

describe('inboxSignal', () => {
	const task = (over: Record<string, unknown> = {}) =>
		({ id: 'a', status: 'working', eta: { minutes: 12 }, ...over }) as never;
	const message = (over: Record<string, unknown> = {}) =>
		({
			requestId: 'r1',
			text: 'x',
			delivery: 'delivered',
			acknowledged: false,
			reply: null,
			...over
		}) as never;
	const sig = (tasks: never[], messages: never[]) =>
		inboxSignal({ tasks, secondMates: [] }, { messages });

	it('ignores a moved work-time estimate and changes for what a card is built from', () => {
		const base = sig([task()], [message()]);
		expect(sig([task({ eta: { minutes: 11 } })], [message()])).toBe(base);
		expect(sig([task({ status: 'needs-decision' })], [message()])).not.toBe(base);
		expect(sig([task()], [message({ acknowledged: true })])).not.toBe(base);
		expect(sig([task()], [message({ reply: { body: 'ok', at: 'x' } })])).not.toBe(base);
		expect(inboxSignal(null, null)).toBe(inboxSignal(null, null));
	});
});
