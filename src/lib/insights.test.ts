import { describe, expect, it } from 'vitest';
import { byDay, duration, etaLine, minutes, sumSplits, total } from './insights';
import type { WorkEta } from './types';

const eta = (over: Partial<WorkEta>): WorkEta => ({
	openEnded: false,
	minutes: 20,
	low: 15,
	high: 30,
	basis: 5,
	scope: 'project',
	confidence: 'rough',
	overdue: false,
	elapsed: 600,
	ahead: [],
	...over
});

describe('durations', () => {
	it('reads naturally', () => {
		expect(duration(42)).toBe('42s');
		expect(duration(600)).toBe('10 min');
		expect(minutes(65)).toBe('1h 5m');
		expect(minutes(120)).toBe('2h');
		expect(minutes(3 * 1440)).toBe('3 days');
	});
});

describe('etaLine', () => {
	it('gives the estimate with its basis', () => {
		expect(etaLine(eta({}))).toMatchObject({ text: 'About 20 min left', tone: 'normal' });
		expect(etaLine(eta({})).note).toContain('Based on 5 similar tasks in this project.');
	});
	it('says when work is taking longer than usual', () => {
		expect(etaLine(eta({ overdue: true }))).toMatchObject({
			text: 'Taking longer than usual',
			tone: 'warning'
		});
	});
	it('shows time under way for open-ended work', () => {
		expect(etaLine(eta({ openEnded: true, minutes: null, elapsed: 4500 })).text).toBe(
			'Under way 1h 15m · no set end'
		);
	});
	it('says when there is no estimate yet', () => {
		expect(etaLine(eta({ minutes: null })).text).toBe('No estimate yet');
	});
});

describe('splits', () => {
	it('adds splits per segment', () => {
		const s = sumSplits([
			{ seconds: { build: 1, review: 2, deciding: 0, ci: 3, captain: 4 } },
			{ seconds: { build: 1, review: 0, deciding: 1, ci: 0, captain: 0 } }
		]);
		expect(s).toEqual({ build: 2, review: 2, deciding: 1, ci: 3, captain: 4 });
		expect(total(s)).toBe(12);
	});
});

describe('byDay', () => {
	it('groups under Today and Yesterday', () => {
		const now = new Date('2026-03-10T15:00:00').getTime();
		const g = byDay(
			['2026-03-10T09:00:00', '2026-03-10T08:00:00', '2026-03-09T20:00:00'],
			(x) => new Date(x).toISOString(),
			now
		);
		expect(g.map(([k, v]) => [k, v.length])).toEqual([
			['Today', 2],
			['Yesterday', 1]
		]);
	});
});
