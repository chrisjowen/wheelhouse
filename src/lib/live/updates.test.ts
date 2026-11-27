import { describe, expect, it } from 'vitest';
import type { Item } from '$lib/chat/fold';
import { aboutUpdate, liveUpdates } from './updates';

const at = (m: number) => `2026-11-27T10:${String(m).padStart(2, '0')}:00.000Z`;
const turn = (id: string, m: number, text: string, done = true): Item => ({
	kind: 'turn',
	id,
	at: at(m),
	parts: [{ kind: 'text', id: `${id}:0`, text }] as Extract<Item, { kind: 'turn' }>['parts'],
	durationMs: 1000,
	done,
	interrupted: false,
	trigger: 'background'
});

describe('Live mode’s updates', () => {
	it('streams Firstmate’s reports and what moved on the fleet, newest last', () => {
		const items: Item[] = [
			turn('old', 1, 'Before the window.'),
			turn('a', 12, '**PR ready** for the pricing page.\n\nMore detail below.'),
			turn('quiet', 14, 'All quiet.'),
			turn('busy', 16, 'Still writing…', false),
			{ kind: 'user', id: 'u', text: 'Hi', at: at(13), queued: false, command: false }
		];
		const moved = [
			{
				taskId: 'sync',
				task: 'Sync scout',
				projectId: 'lumen',
				text: 'Reading the logs',
				at: at(13)
			},
			{ taskId: 'gone', task: 'Gone', projectId: 'lumen', text: 'Landed', at: at(2) }
		];
		const out = liveUpdates(moved, items, Date.parse(at(10)));
		expect(out.map((u) => [u.from, u.title, u.text])).toEqual([
			['firstmate', 'Firstmate', 'PR ready for the pricing page.'],
			['task', 'Sync scout', 'Reading the logs']
		]);
		expect(out[1].taskId).toBe('sync');
	});

	it('keeps the latest few', () => {
		const items = Array.from({ length: 20 }, (_, i) => turn(`t${i}`, 20 + i, `Report ${i}`));
		const out = liveUpdates([], items, 0, 5);
		expect(out.map((u) => u.text)).toEqual([15, 16, 17, 18, 19].map((i) => `Report ${i}`));
	});

	it('raises an update in the discussion in the captain’s words', () => {
		const [u] = liveUpdates([], [turn('a', 12, 'PR ready for the pricing page.')], 0);
		expect(aboutUpdate(u)).toContain('Firstmate just reported: “PR ready for the pricing page.”');
		expect(
			aboutUpdate({ ...u, from: 'task', title: 'Sync scout', text: 'Reading the logs' })
		).toContain('“Sync scout”: Reading the logs');
	});
});
