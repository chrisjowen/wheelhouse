import { describe, expect, it } from 'vitest';
import type { TaskSummary } from '../types';
import type { Item } from './fold';
import { clearedStart, itemOf, previewKey, sameWhile, tagKey, windowStart } from './window';

const items = Array.from({ length: 10 }, (_, i) => ({ id: `i${i}` }));

describe('windowStart', () => {
	it('draws the latest items, or all of a short chat', () => {
		expect(windowStart(items, null, 4)).toBe(6);
		expect(windowStart(items, null, 40)).toBe(0);
	});

	it('holds where the captain reads back from, and lets go once that item is gone', () => {
		expect(windowStart(items, 'i2', 4)).toBe(2);
		expect(windowStart(items, 'gone', 4)).toBe(6);
	});
});

describe('itemOf', () => {
	const chat = [
		{ kind: 'user', id: 'u1' },
		{ kind: 'turn', id: 't1', parts: [{ kind: 'text', id: 'p1-t' }] }
	] as unknown as Item[];

	it('finds the item drawing a bubble: a message, a reply part or one of its sections', () => {
		expect(itemOf(chat, 'u1')).toBe(0);
		expect(itemOf(chat, 'p1-t')).toBe(1);
		expect(itemOf(chat, 'p1-t#2')).toBe(1);
		expect(itemOf(chat, 'nope')).toBe(-1);
	});
});

describe('sameWhile', () => {
	const task = (o: Partial<TaskSummary>) =>
		({
			id: 'a',
			projectId: 'p',
			status: 'working',
			mergedAt: null,
			pr: null,
			preview: null,
			board: null,
			...o
		}) as TaskSummary;

	it('keeps the tasks it was given while nothing tagging reads of them changes', () => {
		const tags = sameWhile(tagKey);
		const first = [task({})];
		expect(tags(first)).toBe(first);
		// A fleet push with only progress changed: the same tasks as before.
		expect(tags([task({ status: 'needs-review' })])).toBe(first);
		const moved = [task({ projectId: 'q' })];
		expect(tags(moved)).toBe(moved);
	});

	it('places previews again when a task lands or reports a preview', () => {
		const cards = sameWhile(previewKey);
		const first = [task({})];
		expect(cards(first)).toBe(first);
		const landed = [task({ status: 'landed', mergedAt: '2026-11-17T10:00:00Z' })];
		expect(cards(landed)).toBe(landed);
		const shown = [
			task({
				status: 'landed',
				mergedAt: '2026-11-17T10:00:00Z',
				preview: { url: 'http://localhost:5173', reportedAt: '2026-11-17T09:00:00Z' }
			})
		];
		expect(cards(shown)).toBe(shown);
	});
});

describe('clearedStart', () => {
	const timed = ['10:00', '10:05', '10:10'].map((t) => ({ at: `2026-11-20T${t}:00.000Z` }));
	it('starts after the clear, at nothing when all came before it, and at the top when never cleared', () => {
		expect(clearedStart(timed, '2026-11-20T10:05:00.000Z')).toBe(2);
		expect(clearedStart(timed, '2026-11-20T09:00:00.000Z')).toBe(0);
		expect(clearedStart(timed, '2026-11-20T11:00:00.000Z')).toBe(3);
		expect(clearedStart(timed, null)).toBe(0);
		expect(clearedStart(timed, 'not a time')).toBe(0);
	});
});
