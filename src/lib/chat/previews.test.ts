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
		expect(cards.get('b-t')).toEqual([
			{ task: share, url: 'http://127.0.0.1:5240/', board: false, landed: false }
		]);
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
		const card = { task: landed, url: 'http://127.0.0.1:5240/', board: false, landed: true };
		expect(previewCards(items, [landed])).toEqual(new Map([['c-t', [card]]]));
		// With no reply since it merged, the card stays where it was, and says it has landed.
		expect(previewCards(items.slice(0, 1), [landed])).toEqual(new Map([['b-t', [card]]]));
	});

	it('shows nothing for a task without a preview or a reply about it', () => {
		const items = [reply('a', 11, 'Nothing about it here.')];
		expect(previewCards(items, [share]).size).toBe(0);
		expect(
			previewCards([reply('b', 11, 'lumen-share-links')], [{ ...share, preview: null }]).size
		).toBe(0);
	});

	it('moves the card to the latest reply that links the preview', () => {
		const items = [
			reply('b', 11, 'Round 1: http://127.0.0.1:5240/'),
			reply('c', 20, 'lumen-share-links: checks green.'),
			reply('d', 30, 'Round 2 is up at http://127.0.0.1:5240/share')
		];
		expect([...previewCards(items, [share]).keys()]).toEqual(['d-t']);
	});

	it('shows a board a task reported, and links it from the card', () => {
		const board = taskSummary('lumen-board', 'needs-decision', {
			board: { url: 'http://127.0.0.1:4387/session/c03d', reportedAt: iso(10) }
		});
		const cards = previewCards(
			[reply('a', 12, 'On the board: http://127.0.0.1:4387/session/c03d.')],
			[board]
		);
		expect(cards.get('a-t')).toEqual([
			{ task: board, url: 'http://127.0.0.1:4387/session/c03d', board: true, landed: false }
		]);
	});

	it('knows a second mate’s task by its id in its own home', () => {
		const remote = taskSummary('wh-style@far-mate', 'working', {
			secondMate: { id: 'far-mate', host: 'far', where: 'remote' },
			preview: { url: 'http://127.0.0.1:5391/?style=a', reportedAt: iso(10) }
		});
		expect(mentions('wh-style is ready for a look', remote)).toBe(true);
		expect(mentions('wh-style-2 is ready', remote)).toBe(false);
		expect([...previewCards([reply('a', 12, 'wh-style is up')], [remote]).keys()]).toEqual(['a-t']);
	});
});

// The regression: Firstmate links previews no task reported with a `preview <url>` line (its own
// servers, a forwarded second-mate port, a Lavish board), and none of them showed a box.
describe('previewCards for addresses no task reported', () => {
	it('shows a box for every address on this machine a reply links', () => {
		const cards = previewCards(
			[
				reply(
					'a',
					1,
					'The prototype is on the board at http://127.0.0.1:4387/session/8b4a (direct: **http://127.0.0.1:4612/**).'
				)
			],
			[]
		);
		expect(cards.get('a-t')).toEqual([
			{ task: null, url: 'http://127.0.0.1:4387/session/8b4a', board: true, landed: false },
			{ task: null, url: 'http://127.0.0.1:4612/', board: false, landed: false }
		]);
	});

	it('puts each box under the latest reply that links it, one per server under a reply', () => {
		const items = [
			reply(
				'a',
				1,
				'A http://127.0.0.1:5288/a, B http://127.0.0.1:5288/b, C http://127.0.0.1:5288/c'
			),
			reply('b', 5, 'Forwarded to http://127.0.0.1:45391/?style=c'),
			reply('c', 9, 'Round 2 of A: http://127.0.0.1:5288/a')
		];
		const cards = previewCards(items, []);
		expect([...cards.keys()]).toEqual(['b-t', 'c-t']);
		expect(cards.get('c-t')?.map((c) => c.url)).toEqual(['http://127.0.0.1:5288/a']);
	});

	it('leaves out addresses in code, other machines and Wheelhouse’s own pages', () => {
		const items = [
			reply(
				'a',
				1,
				'Set `http://localhost:3000/cb`, see https://example.com and http://127.0.0.1:4310/second-mates'
			)
		];
		expect(previewCards(items, [], '4310').size).toBe(0);
	});

	it('leaves an address a task reported to that task’s card', () => {
		const items = [reply('b', 11, 'Preview: http://127.0.0.1:5240/?v=2')];
		const cards = previewCards(items, [share]);
		expect(cards.get('b-t')?.map((c) => c.task?.id ?? null)).toEqual(['lumen-share-links']);
		// Another port is not that task's.
		expect(
			previewCards([reply('b', 11, 'http://127.0.0.1:52400/')], [share]).get('b-t')?.[0].task
		).toBeNull();
	});

	it('gives another page on a task’s server, or a landed task’s address, a box of its own', () => {
		const sub = previewCards([reply('b', 11, 'Prototype: http://127.0.0.1:5240/proto')], [share]);
		expect(sub.get('b-t')?.find((c) => c.task === null)?.url).toBe('http://127.0.0.1:5240/proto');
		const landed = { ...share, status: 'landed' as const, mergedAt: iso(30) };
		const later = previewCards(
			[reply('c', 40, 'New prototype on http://127.0.0.1:5240/')],
			[landed]
		);
		expect(later.get('c-t')?.find((c) => c.task === null)?.url).toBe('http://127.0.0.1:5240/');
	});
});
