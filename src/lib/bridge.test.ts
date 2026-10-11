import { describe, expect, it } from 'vitest';
import {
	composerKey,
	extractUrls,
	feed,
	linkify,
	matchTasks,
	mergeLocal,
	newRequestId,
	onDeck,
	type LocalMessage
} from './bridge';
import type { BridgeMessage, TaskStatus, TaskSummary } from './types';

function task(id: string, status: TaskStatus, o: Partial<TaskSummary> = {}): TaskSummary {
	return {
		id,
		title: id,
		projectId: 'p',
		kind: 'ship',
		track: 'ship',
		status,
		statusLabel: status,
		summary: null,
		summaryIsHistory: false,
		worker: null,
		branch: null,
		passage: { track: 'ship', steps: [], current: 0, basis: '' },
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

describe('onDeck', () => {
	it('counts the fleet and lists what needs the captain and what is moving', () => {
		const now = Date.parse('2026-10-11T12:00:00Z');
		const d = onDeck(
			[
				task('rev', 'needs-review', {
					attention: { kind: 'review', owner: 'captain', text: '', url: null }
				}),
				task('fm', 'with-firstmate', {
					attention: { kind: 'decision', owner: 'firstmate', text: '', url: null }
				}),
				task('w', 'working'),
				task('q', 'queued'),
				task('l', 'landed', { mergedAt: '2026-10-11T11:00:00Z' }),
				task('old', 'landed', { mergedAt: '2026-10-01T11:00:00Z' })
			],
			now
		);
		expect(d.counts).toEqual({ needsYou: 1, underWay: 2, queued: 1, landed: 1 });
		expect(d.needsYou.map((t) => t.id)).toEqual(['rev']);
		expect(d.underWay.map((t) => t.id)).toEqual(['fm', 'w']);
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
