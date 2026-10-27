import { describe, expect, it } from 'vitest';
import { changesLine, changeWhere, runAt, runLine, runStep, splitChanges } from './changes';
import type { ChangeRequest, Passage, TaskRun, TaskRuns } from './types';

const req = (o: Partial<ChangeRequest> = {}): ChangeRequest => ({
	id: 'x',
	source: 'github',
	kind: 'thread',
	author: 'captain',
	text: 'Rename it',
	at: '2026-10-27T10:00:00Z',
	url: null,
	where: null,
	state: 'open',
	...o
});
const run = (o: Partial<TaskRun> & { n: number }): TaskRun => ({
	startedAt: null,
	readyAt: null,
	endedAt: null,
	outcome: 'building',
	basis: null,
	changes: [],
	...o
});
const T = (h: number, m = 0) =>
	`2026-10-27T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00.000Z`;
const RUNS: TaskRuns = {
	current: 2,
	reworking: true,
	runs: [
		run({ n: 1, startedAt: T(8), readyAt: T(9, 5), endedAt: T(10), outcome: 'changes-requested' }),
		run({ n: 2, startedAt: T(10), changes: [req({ id: 'a' }), req({ id: 'b' })] })
	]
};

describe('changes wording', () => {
	it('names the file and line a request is on', () => {
		expect(changeWhere(req({ where: { path: 'src/a.ts', line: 7 } }))).toBe('src/a.ts, line 7');
		expect(changeWhere(req({ where: { path: 'src/a.ts', line: null } }))).toBe('src/a.ts');
		expect(changeWhere(req())).toBeNull();
	});

	it('puts what is still to do apart from what was resolved or addressed', () => {
		const { open, done } = splitChanges([
			req({ id: 'a' }),
			req({ id: 'b', state: 'resolved' }),
			req({ id: 'c', state: 'addressed' })
		]);
		expect(open.map((c) => c.id)).toEqual(['a']);
		expect(done.map((c) => c.id)).toEqual(['b', 'c']);
	});

	it('counts them in one line', () => {
		expect(changesLine(null)).toBeNull();
		expect(changesLine([])).toBeNull();
		expect(
			changesLine([req({ id: 'a' }), req({ id: 'b' }), req({ id: 'c', state: 'addressed' })])
		).toBe('2 changes to make · 1 done');
		expect(changesLine([req({ state: 'resolved' })])).toBe('1 done');
	});
});

describe('runs', () => {
	const passage = {
		steps: [{ label: 'Queued' }, { label: 'Building' }],
		current: 1
	} as unknown as Passage;

	it('names a later run with its step', () => {
		expect(runStep({ runs: RUNS, passage })).toBe('Run 2 · Building');
		expect(
			runStep({ runs: { ...RUNS, current: 1, runs: RUNS.runs.slice(0, 1) }, passage })
		).toBeNull();
		expect(runStep({ runs: null, passage })).toBeNull();
	});

	it('places a moment in the run under way then', () => {
		expect(runAt(RUNS, T(8, 30))).toBe(1);
		expect(runAt(RUNS, T(10, 1))).toBe(2);
		expect(runAt(RUNS, T(7))).toBe(1);
		expect(runAt(null, T(9))).toBe(1);
	});

	it('sums a run up in a line', () => {
		const now = Date.parse(T(10, 12));
		expect(runLine(RUNS, RUNS.runs[0], now)).toBe('Built in 1h 5m · 2 changes requested');
		expect(runLine(RUNS, RUNS.runs[1], now)).toBe('12 min so far');
	});
});
