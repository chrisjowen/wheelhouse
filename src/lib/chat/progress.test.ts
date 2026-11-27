import { describe, expect, it } from 'vitest';
import type { Item, Part } from './fold';
import { firstWords, progressRuns } from './progress';

const at = (m: number) => new Date(Date.parse('2026-10-27T10:00:00Z') + m * 60_000).toISOString();
const turn = (
	id: string,
	text: string,
	o: Partial<Extract<Item, { kind: 'turn' }>> = {}
): Item => ({
	kind: 'turn',
	id,
	parts: [{ kind: 'text', id: `${id}-t`, text }] as Part[],
	at: at(Number(id.replace(/\D/g, '')) || 0),
	durationMs: 1000,
	done: true,
	interrupted: false,
	trigger: 'background',
	...o
});
const user = (id: string): Item => ({
	kind: 'user',
	id,
	text: 'hi',
	at: at(0),
	queued: false,
	command: false
});
const all = () => true;
const none = () => false;

describe('routine progress in the chat', () => {
	it('folds a run of supervision reports into one line with the latest', () => {
		const items = [
			turn('p1', 'Share links: CI is green.'),
			turn('p2', '**Docs search**: 3 of 5 checks')
		];
		const runs = progressRuns(items, all, none, none);
		const r = runs.get('p1')!;
		expect(runs.get('p2')).toBe(r);
		expect(r).toMatchObject({
			first: 'p1',
			ids: ['p1', 'p2'],
			latest: 'Docs search: 3 of 5 checks'
		});
		expect(r.at).toBe(items[1].at);
	});

	it('never folds the captain’s own conversation, or a report that asks something', () => {
		const ask: Item = {
			...turn('p3', 'Which one?'),
			parts: [{ kind: 'question', id: 'q', questions: [], answers: null }]
		} as Item;
		const items = [
			turn('p1', 'Progress.'),
			user('u1'),
			turn('c1', 'On it.', { trigger: 'captain' }),
			turn('p2', 'Has a form', {}),
			ask,
			turn('p4', 'Still going.', { done: false })
		];
		const runs = progressRuns(items, all, (part) => part === 'p2-t', none);
		expect([...runs.keys()]).toEqual(['p1']);
	});

	it('runs on across what another thread hides, but stops where something is drawn between', () => {
		const items = [turn('p1', 'a'), user('u1'), turn('p2', 'b'), turn('p3', 'c')];
		const runs = progressRuns(
			items,
			(id) => id !== 'u1',
			none,
			(i) => i === 3
		);
		expect(runs.get('p1')?.ids).toEqual(['p1', 'p2']);
		expect(runs.get('p3')?.ids).toEqual(['p3']);
	});

	it('reads a reply’s first line as plain words, cut short', () => {
		expect(firstWords('\n- **Merged** [#142](https://x)\nmore')).toBe('Merged #142');
		expect(firstWords('```\ncode\n```\n# Heading')).toBe('Heading');
		expect(firstWords('x'.repeat(200))).toHaveLength(120);
	});
});
