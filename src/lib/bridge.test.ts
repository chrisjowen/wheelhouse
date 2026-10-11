import { describe, expect, it } from 'vitest';
import {
	captainDecision,
	composerKey,
	extractUrls,
	feed,
	linkify,
	matchTasks,
	mergeLocal,
	needsLook,
	newRequestId,
	optionDraft,
	outgoing,
	parseDecision,
	shelfThreads,
	threadMessages,
	threads,
	type LocalMessage
} from './bridge';
import type { BridgeMessage, TaskStatus, TaskSummary } from './types';

const NO_DECLARED = { custom: false, live: null, link: null, checks: [] };

function task(id: string, status: TaskStatus, o: Partial<TaskSummary> = {}): TaskSummary {
	return {
		id,
		title: id,
		shortTitle: id,
		projectId: 'p',
		kind: 'ship',
		track: 'ship',
		status,
		statusLabel: status,
		summary: null,
		summaryIsHistory: false,
		summaryRaw: null,
		activity: null,
		busy: false,
		pipeline: null,
		filesChanged: null,
		worker: null,
		branch: null,
		passage: { track: 'ship', steps: [], current: 0, basis: '', ...NO_DECLARED },
		attention: null,
		current: null,
		pr: null,
		since: null,
		completedOn: null,
		mergedAt: null,
		preview: null,
		blockedBy: [],
		hasReport: false,
		outputAvailable: false,
		outputNote: null,
		thumb: { kind: 'none' },
		screenshots: 0,
		...o
	};
}

function message(requestId: string, o: Partial<BridgeMessage> = {}): BridgeMessage {
	return {
		requestId,
		text: requestId,
		taskId: null,
		submittedAt: '2026-10-11T12:00:00Z',
		delivery: 'delivered',
		deliveryDetail: null,
		acknowledged: null,
		noteId: null,
		reply: null,
		...o
	};
}

describe('report-in task cards', () => {
	const tasks = [
		task('wh-crew-1', 'needs-review', {
			pr: { url: 'https://github.com/o/r/pull/7', number: 7 }
		}),
		task('wh-proto', 'working', {
			preview: { url: 'http://127.0.0.1:4310/', reportedAt: '2026-10-11T11:00:00Z' }
		}),
		task('other', 'working', { pr: { url: 'https://github.com/o/r/pull/70', number: 70 } })
	];

	it('extracts URLs without trailing punctuation', () => {
		expect(
			extractUrls('PR is up (https://github.com/o/r/pull/7). Preview: http://127.0.0.1:4310/.')
		).toEqual(['https://github.com/o/r/pull/7', 'http://127.0.0.1:4310/']);
	});

	it('matches only an exact PR or preview URL', () => {
		const ids = (text: string) => matchTasks(text, tasks).map((t) => t.id);
		expect(ids('PR ready: https://github.com/o/r/pull/7, have a look.')).toEqual(['wh-crew-1']);
		expect(ids('Live at http://127.0.0.1:4310/')).toEqual(['wh-proto']);
		expect(ids('https://github.com/o/r/pull/7 and http://127.0.0.1:4310/')).toEqual([
			'wh-crew-1',
			'wh-proto'
		]);
		expect(ids('https://github.com/o/r/pull/7/files')).toEqual([]);
		expect(ids('https://github.com/o/r/pull/')).toEqual([]);
		expect(ids('wh-crew-1 is done, see the PR')).toEqual([]);
	});

	it('splits text into plain runs and links', () => {
		expect(linkify('See https://x.test/a. Thanks')).toEqual([
			{ text: 'See ', url: false },
			{ text: 'https://x.test/a', url: true },
			{ text: '. Thanks', url: false }
		]);
		expect(linkify('no links')).toEqual([{ text: 'no links', url: false }]);
	});
});

describe('feed', () => {
	it('puts replies after their message, in time order with later messages', () => {
		const items = feed([
			message('a', {
				submittedAt: '2026-10-11T12:00:00Z',
				reply: { body: 'late answer', at: '2026-10-11T12:30:00Z' }
			}),
			message('b', {
				submittedAt: '2026-10-11T12:10:00Z',
				reply: { body: 'quick answer', at: '2026-10-11T12:11:00Z' }
			})
		]);
		expect(items.map((i) => i.key)).toEqual(['m:a', 'm:b', 'r:b', 'r:a']);
		expect(
			items.filter((i) => i.kind === 'reply').map((i) => i.kind === 'reply' && i.quote)
		).toEqual([false, true]);
	});

	it('never shows a reply before its message, even with a skewed or missing time', () => {
		const items = feed([
			message('a', {
				submittedAt: '2026-10-11T12:00:00Z',
				reply: { body: 'x', at: '2026-10-11T11:00:00Z' }
			}),
			message('b', { submittedAt: '2026-10-11T12:05:00Z', reply: { body: 'y', at: null } })
		]);
		expect(items.map((i) => i.key)).toEqual(['m:a', 'r:a', 'm:b', 'r:b']);
	});
});

describe('mergeLocal', () => {
	it('keeps the server copy of a message and appends the browser’s unconfirmed ones', () => {
		const local: LocalMessage[] = [
			{ ...message('a'), delivery: 'unsent' },
			{ ...message('b'), delivery: 'sending' }
		];
		expect(mergeLocal([message('a')], local).map((m) => [m.requestId, m.delivery])).toEqual([
			['a', 'delivered'],
			['b', 'sending']
		]);
	});
});

it('makes request ids fm-inbox.sh accepts', () => {
	const id = newRequestId();
	expect(id).toMatch(/^wh-[0-9a-f-]{36}$/);
	expect(newRequestId()).not.toBe(id);
});

describe('composerKey', () => {
	const key = (o: Partial<Parameters<typeof composerKey>[0]>) =>
		composerKey({ key: 'Enter', shiftKey: false, ...o });

	it('sends on Enter, including Cmd/Ctrl+Enter', () => {
		expect(key({})).toBe('send');
		// Shaped like a KeyboardEvent: modifier keys the composer does not look at.
		const cmd = { key: 'Enter', shiftKey: false, metaKey: true };
		const ctrl = { key: 'Enter', shiftKey: false, ctrlKey: true };
		expect(composerKey(cmd)).toBe('send');
		expect(composerKey(ctrl)).toBe('send');
	});

	it('inserts a new line on Shift+Enter', () => {
		expect(key({ shiftKey: true })).toBe('newline');
	});

	it('never sends while an input method is composing', () => {
		expect(key({ isComposing: true })).toBeNull();
		expect(key({ keyCode: 229 })).toBeNull();
	});

	it('ignores other keys', () => {
		expect(key({ key: 'a' })).toBeNull();
		expect(key({ key: 'Tab', shiftKey: true })).toBeNull();
	});
});

describe('threads', () => {
	const decision = {
		kind: 'decision' as const,
		owner: 'captain' as const,
		text: 'Pick one. Options: (a) x (b) y',
		url: null
	};
	const tasks = [
		task('wh-a', 'working', { title: 'Task A' }),
		task('wh-hold', 'needs-decision', { title: 'Held', attention: decision }),
		task('wh-old', 'landed', { title: 'Old' }),
		task('wh-quiet', 'working')
	];
	const messages: LocalMessage[] = [
		message('g1', { submittedAt: '2026-10-11T10:00:00Z', reply: { body: 'hi', at: null } }),
		message('a1', { taskId: 'wh-a', submittedAt: '2026-10-11T11:00:00Z' }),
		message('a2', {
			taskId: 'wh-a',
			submittedAt: '2026-10-11T11:05:00Z',
			reply: { body: 'on it', at: '2026-10-11T11:30:00Z' }
		}),
		message('o1', { taskId: 'wh-old', submittedAt: '2026-10-11T09:00:00Z' }),
		message('gone', { taskId: 'wh-cleaned', submittedAt: '2026-10-11T08:00:00Z' })
	];

	it('shows only the focused task’s messages, with their replies', () => {
		const a = threadMessages(messages, 'wh-a');
		expect(a.map((m) => m.requestId)).toEqual(['a1', 'a2']);
		expect(feed(a).map((i) => i.key)).toEqual(['m:a1', 'm:a2', 'r:a2']);
		expect(threadMessages(messages, 'wh-quiet')).toEqual([]);
	});

	it('keeps messages with no task in the general thread', () => {
		expect(threadMessages(messages, null).map((m) => m.requestId)).toEqual(['g1']);
	});

	it('lists general first, then what needs the captain, then the most recent', () => {
		const list = threads(messages, tasks, null, new Set());
		expect(list.map((t) => t.taskId)).toEqual([null, 'wh-hold', 'wh-a', 'wh-old', 'wh-cleaned']);
		expect(list[0].title).toBe('General');
		expect(list.find((t) => t.taskId === 'wh-cleaned')?.title).toBe('wh-cleaned');
		expect(list.find((t) => t.taskId === 'wh-hold')?.needsYou).toBe(true);
	});

	it('adds the focused task even with no messages', () => {
		const ids = threads(messages, tasks, 'wh-quiet', new Set()).map((t) => t.taskId);
		expect(ids).toContain('wh-quiet');
	});

	it('counts replies the captain has not seen', () => {
		const unread = (seen: string[]) =>
			Object.fromEntries(
				threads(messages, tasks, null, new Set(seen)).map((t) => [t.title, t.unread])
			);
		expect(unread([])).toMatchObject({ General: 1, 'Task A': 1, Held: 0 });
		expect(unread(['a2', 'g1'])).toMatchObject({ General: 0, 'Task A': 0 });
	});

	it('splits threads into under way (with general) and completed', () => {
		const list = threads(messages, tasks, null, new Set());
		expect(shelfThreads(list, 'under-way').map((t) => t.taskId)).toEqual([
			null,
			'wh-hold',
			'wh-a',
			'wh-cleaned'
		]);
		expect(shelfThreads(list, 'completed').map((t) => t.taskId)).toEqual(['wh-old']);
	});

	it('counts only threads on the shown shelf as needing a look', () => {
		const late = message('o2', {
			taskId: 'wh-old',
			submittedAt: '2026-10-11T09:05:00Z',
			reply: { body: 'landed it', at: '2026-10-11T09:10:00Z' }
		});
		const list = threads([...messages, late], tasks, 'wh-a', new Set(['g1', 'a2']));
		expect(needsLook(shelfThreads(list, 'under-way'), 'wh-a').map((t) => t.taskId)).toEqual([
			'wh-hold'
		]);
		expect(needsLook(shelfThreads(list, 'completed'), 'wh-a').map((t) => t.taskId)).toEqual([
			'wh-old'
		]);
		expect(needsLook(shelfThreads(list, 'completed'), 'wh-old')).toEqual([]);
	});
});

describe('parseDecision', () => {
	it('splits a captain hold into the question and its options', () => {
		expect(
			parseDecision(
				'How should Wheelhouse support realtime brainstorming? Options: (a) embed a terminal; (b) a chat over SSE, or (c) defer it.'
			)
		).toEqual({
			question: 'How should Wheelhouse support realtime brainstorming?',
			options: [
				{ marker: '(a)', text: 'embed a terminal' },
				{ marker: '(b)', text: 'a chat over SSE' },
				{ marker: '(c)', text: 'defer it.' }
			]
		});
	});

	it('reads options without an Options: label, and numbered options', () => {
		expect(parseDecision('Merge now? (a) yes (b) no').options.map((o) => o.text)).toEqual([
			'yes',
			'no'
		]);
		expect(parseDecision('Which? Options:\n(1) one\n(2) two').options).toEqual([
			{ marker: '(1)', text: 'one' },
			{ marker: '(2)', text: 'two' }
		]);
	});

	it('keeps markers that are not the next option inside the option text', () => {
		expect(parseDecision('Pick: Options: (a) keep (see notes) (b) drop (a) again').options).toEqual(
			[
				{ marker: '(a)', text: 'keep (see notes)' },
				{ marker: '(b)', text: 'drop (a) again' }
			]
		);
	});

	it('falls back to plain text when there are no options', () => {
		const text = 'A worker wants to rename the CLI; is that fine?';
		expect(parseDecision(text)).toEqual({ question: text, options: [] });
		expect(parseDecision('Only one: (a) this')).toEqual({
			question: 'Only one: (a) this',
			options: []
		});
		expect(parseDecision('Options: (b) late start (c) next').options).toEqual([]);
	});

	it('is asked only for a captain decision', () => {
		const t = (attention: TaskSummary['attention']) =>
			captainDecision(task('x', 'needs-decision', { attention }));
		expect(
			t({ kind: 'decision', owner: 'captain', text: 'Go? (a) yes (b) no', url: null })
		).toEqual({
			question: 'Go?',
			options: [
				{ marker: '(a)', text: 'yes' },
				{ marker: '(b)', text: 'no' }
			]
		});
		expect(t({ kind: 'decision', owner: 'firstmate', text: 'x', url: null })).toBeNull();
		expect(t({ kind: 'review', owner: 'captain', text: 'x', url: null })).toBeNull();
		expect(captainDecision(null)).toBeNull();
	});
});

describe('inline answer', () => {
	it('prefills the option marker and sends the answer about the thread’s task', () => {
		const { options } = parseDecision('Ship it? Options: (a) now (b) after review');
		const draft = `${optionDraft(options[1])}and add a screenshot  `;
		const at = new Date('2026-10-11T12:00:00Z');
		expect(outgoing(draft, 'wh-hold', 'wh-req', at)).toEqual({
			requestId: 'wh-req',
			text: '(b) and add a screenshot',
			taskId: 'wh-hold',
			submittedAt: '2026-10-11T12:00:00.000Z',
			delivery: 'sending',
			deliveryDetail: null,
			acknowledged: null,
			noteId: null,
			reply: null
		});
	});

	it('keeps the typed answer when an option is picked, swapping only a leading marker', () => {
		const { options } = parseDecision('Ship it? Options: (a) now (b) after review');
		expect(optionDraft(options[0], '')).toBe('(a) ');
		expect(optionDraft(options[1], 'because the tests are flaky')).toBe(
			'(b) because the tests are flaky'
		);
		expect(optionDraft(options[1], '(a) because the tests are flaky')).toBe(
			'(b) because the tests are flaky'
		);
		expect(optionDraft(options[0], '(12)  later')).toBe('(a) later');
	});

	it('sends from the general thread with no task', () => {
		expect(outgoing('hello', null, 'r', new Date(0)).taskId).toBeNull();
	});
});
