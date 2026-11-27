import { describe, expect, it } from 'vitest';
import type { Pipeline, TaskSummary } from '$lib/types';
import { taskSummary } from '../../tests/helpers/task-summary';
import { helmOf, newlyLanded } from './helm';

const run = (o: Partial<Pipeline> = {}): Pipeline => ({
	step: 'review',
	label: 'Review',
	startedAt: null,
	round: null,
	steps: [],
	outcome: 'running',
	gate: null,
	answered: false,
	roundStartedAt: null,
	ci: null,
	observedAt: null,
	...o
});
const building = (id: string) => taskSummary(id, 'working', { busy: true });
const scouting = (id: string) => taskSummary(id, 'working', { busy: true, track: 'scout' });
const checking = (id: string) => taskSummary(id, 'working', { busy: true, pipeline: run() });
const captain = (id: string) =>
	taskSummary(id, 'needs-decision', {
		attention: { kind: 'decision', owner: 'captain', text: 'Which way?', url: null }
	});
const shown = (tasks: TaskSummary[], calls = 0, firstmate = false) => {
	const h = helmOf(tasks, calls, firstmate);
	return [h.kind, h.idea, h.tint];
};

describe('helmOf', () => {
	it('is still when nothing is under way', () => {
		const h = helmOf([taskSummary('a', 'landed'), taskSummary('b', 'queued')], 0, false);
		expect([h.kind, h.idea, h.legend]).toEqual(['rest', 'still', '']);
	});

	it('does not move for a worker that is idle', () => {
		expect(shown([taskSummary('a', 'working', { busy: false })])).toEqual([
			'rest',
			'still',
			'gold'
		]);
	});

	it('shows each kind of work with its own animation and tint', () => {
		expect(shown([scouting('s')])).toEqual(['scouting', 'lantern', 'cool']);
		expect(shown([building('b')])).toEqual(['building', 'mood', 'gold']);
		expect(shown([checking('c')])).toEqual(['checks', 'swell', 'teal']);
		expect(shown([taskSummary('x', 'blocked')])).toEqual(['stuck', 'pulse', 'red']);
		expect(shown([], 1)).toEqual(['captain', 'lighthouse', 'amber']);
	});

	it('lets the most important win: captain, then stuck, checks, building, scouting', () => {
		const all = [scouting('s'), building('b'), checking('c'), taskSummary('x', 'failed')];
		expect(shown(all, 1)[0]).toBe('captain');
		expect(shown(all)[0]).toBe('stuck');
		expect(shown(all.slice(0, 3))[0]).toBe('checks');
		expect(shown(all.slice(0, 2))[0]).toBe('building');
		expect(shown(all.slice(0, 1))[0]).toBe('scouting');
	});

	it('counts each task once, under the most important thing it is doing', () => {
		const h = helmOf(
			[building('b1'), building('b2'), checking('c'), scouting('s'), captain('d')],
			0,
			false
		);
		expect(h.counts).toEqual({ captain: 1, stuck: 0, checks: 1, building: 2, scouting: 1 });
		expect(h.legend).toBe('1 waiting on you · 1 in checks · 2 building · 1 scouting');
	});

	it('counts the calls waiting, or the tasks that need the captain when more', () => {
		expect(helmOf([captain('d')], 3, false).counts.captain).toBe(3);
		expect(helmOf([captain('d'), captain('e')], 1, false).counts.captain).toBe(2);
	});

	it('treats an unreadable worker as not stuck, and a run held at a gate as not checking', () => {
		expect(shown([taskSummary('u', 'unknown')])[0]).toBe('rest');
		const held = taskSummary('g', 'with-firstmate', {
			pipeline: run({ gate: { findings: 2, questions: 1, since: null } })
		});
		expect(shown([held])[0]).toBe('rest');
	});

	it('shows Firstmate at work as building when no worker is busy', () => {
		const h = helmOf([], 0, true);
		expect([h.kind, h.idea, h.legend]).toEqual(['building', 'mood', 'Firstmate at work']);
		expect(helmOf([building('b')], 0, true).legend).toBe('1 building');
	});

	it('speeds up gently with more workers busy, never past half as fast again', () => {
		const one = helmOf([building('a')], 0, false).tempo;
		const three = helmOf([building('a'), building('b'), building('c')], 0, false).tempo;
		const many = helmOf(
			Array.from({ length: 20 }, (_, i) => building(`t${i}`)),
			0,
			false
		).tempo;
		expect(one).toBe(1);
		expect(three).toBeCloseTo(1.24);
		expect(many).toBeLessThanOrEqual(1.6);
	});

	it('keeps the captain’s beam and the stuck pulse slower than building', () => {
		expect(helmOf([], 1, false).tempo).toBeLessThan(1);
		expect(helmOf([taskSummary('x', 'lost')], 0, false).tempo).toBeLessThan(1);
	});
});

describe('newlyLanded', () => {
	it('counts nothing as new on the first look', () => {
		const r = newlyLanded(null, [taskSummary('a', 'landed')]);
		expect(r.landed).toEqual([]);
		expect([...r.known]).toEqual(['a']);
	});

	it('names tasks that landed since the last look', () => {
		const first = newlyLanded(null, [taskSummary('a', 'landed'), taskSummary('b', 'working')]);
		const next = newlyLanded(first.known, [taskSummary('a', 'landed'), taskSummary('b', 'landed')]);
		expect(next.landed).toEqual(['b']);
		expect(newlyLanded(next.known, [taskSummary('a', 'landed')]).landed).toEqual([]);
	});
});
