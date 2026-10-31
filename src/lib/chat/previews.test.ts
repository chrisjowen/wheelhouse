import { describe, expect, it } from 'vitest';
import { taskSummary } from '../../../tests/helpers/task-summary';
import type { Item } from './fold';
import { mentions, previewCards } from './previews';

const T = Date.parse('2026-10-31T09:00:00.000Z');
const iso = (min: number) => new Date(T + min * 60_000).toISOString();

const reply = (id: string, min: number, text: string): Item => ({
	kind: 'turn',
	id,
	parts: [{ kind: 'text', id: `${id}-t`, text }],
	at: iso(min),
	durationMs: null,
	done: true,
	interrupted: false,
	trigger: 'background'
});

const share = taskSummary('lumen-share-links', 'needs-review', {
	pr: { url: 'https://github.com/demo/lumen/pull/212', number: 212 },
	preview: { url: 'http://127.0.0.1:5240/', reportedAt: iso(10) }
});

describe('mentions', () => {
	it('knows a reply about a task by its id, pull request or preview address', () => {
		expect(mentions('lumen-share-links is ready', share)).toBe(true);
		expect(mentions('See https://github.com/demo/lumen/pull/212.', share)).toBe(true);
		expect(mentions('Try http://127.0.0.1:5240 now', share)).toBe(true);
		expect(mentions('Try http://127.0.0.1:5240/?view=share', share)).toBe(true);
	});

	it('does not take a longer id, another pull request or another port for it', () => {
		expect(mentions('lumen-share-links-2 is ready', share)).toBe(false);
		expect(mentions('https://github.com/demo/lumen/pull/2121', share)).toBe(false);
		expect(mentions('http://127.0.0.1:52400', share)).toBe(false);
	});
});

describe('previewCards', () => {
	it('puts the card under the first reply about the task once its preview was reported', () => {
		const items = [
			reply('a', 5, 'lumen-share-links is building.'),
			reply('b', 11, 'The share links preview is up: http://127.0.0.1:5240'),
			reply('c', 20, 'lumen-share-links: checks green.')
		];
		const cards = previewCards(items, [share]);
		expect([...cards.keys()]).toEqual(['b-t']);
		expect(cards.get('b-t')).toEqual([{ task: share, landed: false }]);
	});

	it('counts a reply written just before the report reached the fleet', () => {
		const cards = previewCards([reply('a', 9, 'lumen-share-links has a preview.')], [share]);
		expect([...cards.keys()]).toEqual(['a-t']);
	});

	it('moves the card under the first reply since the work landed, marked landed', () => {
		const landed = { ...share, status: 'landed' as const, mergedAt: iso(30) };
		const items = [
			reply('b', 11, 'Preview: http://127.0.0.1:5240'),
			reply('c', 31, 'lumen-share-links has landed on main.'),
			reply('d', 40, 'lumen-share-links again.')
		];
		expect(previewCards(items, [landed])).toEqual(
			new Map([['c-t', [{ task: landed, landed: true }]]])
		);
		// With no reply since it merged, the card stays where it was, and says it has landed.
		expect(previewCards(items.slice(0, 1), [landed])).toEqual(
			new Map([['b-t', [{ task: landed, landed: true }]]])
		);
	});

	it('shows nothing for a task without a preview or a reply about it', () => {
		const items = [reply('a', 11, 'Nothing about it here.')];
		expect(previewCards(items, [share]).size).toBe(0);
		expect(
			previewCards([reply('b', 11, 'lumen-share-links')], [{ ...share, preview: null }]).size
		).toBe(0);
	});
});
