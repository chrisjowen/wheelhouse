import { describe, expect, it } from 'vitest';
import {
	board,
	boardColumn,
	boardFilterOf,
	boardHeadline,
	cardOutcome,
	cardWait,
	course,
	laneShows,
	progress
} from './harbourboard';
import type { PassageStep, Project, TaskSummary } from './types';
import { taskSummary } from '../../tests/helpers/task-summary';

const NOW = Date.parse('2026-11-17T12:00:00Z');
const hoursAgo = (h: number) => new Date(NOW - h * 3600_000).toISOString();
const captain = {
	kind: 'decision' as const,
	owner: 'captain' as const,
	text: 'Choose the product shape.',
	url: null
};

const project = (id: string, o: Partial<Project> = {}): Project => ({
	id,
	name: id,
	description: null,
	posture: null,
	registered: true,
	path: null,
	passage: null,
	...o
});

const step = (key: string): PassageStep => ({
	key,
	label: key,
	short: key,
	state: 'upcoming',
	note: null,
	column: key,
	evidence: [],
	failed: false
});

/** A task at this step of a queued → building → checks → pr → review → landed passage. */
const at = (t: TaskSummary, column: string): TaskSummary => {
	const keys = ['queued', 'building', 'checks', 'pr', 'review', 'landed'];
	return { ...t, passage: { ...t.passage, steps: keys.map(step), current: keys.indexOf(column) } };
};

const task = (id: string, status: TaskSummary['status'], o: Partial<TaskSummary> = {}) =>
	taskSummary(id, status, o);

describe('boardColumn', () => {
	it('puts what waits on the captain under Waiting on you, whatever its step', () => {
		expect(boardColumn(at(task('a', 'needs-decision'), 'queued'), NOW)).toBe('you');
		expect(boardColumn(at(task('b', 'working', { attention: captain }), 'building'), NOW)).toBe(
			'you'
		);
	});

	it('puts open work in the column of its current step', () => {
		expect(boardColumn(task('q', 'queued'), NOW)).toBe('queued');
		expect(boardColumn(at(task('w', 'working'), 'building'), NOW)).toBe('building');
		expect(boardColumn(at(task('c', 'working'), 'checks'), NOW)).toBe('pr');
		expect(boardColumn(at(task('p', 'waiting'), 'pr'), NOW)).toBe('pr');
		expect(boardColumn(task('r', 'with-reviewers'), NOW)).toBe('pr');
		expect(boardColumn(at(task('l', 'lost'), 'building'), NOW)).toBe('building');
		expect(boardColumn(task('f', 'with-firstmate'), NOW)).toBe('building');
	});

	it('keeps landed work for a day, then takes it off the board with closed work', () => {
		expect(boardColumn(task('new', 'landed', { mergedAt: hoursAgo(9) }), NOW)).toBe('landed');
		expect(boardColumn(task('old', 'landed', { mergedAt: hoursAgo(30) }), NOW)).toBeNull();
		expect(boardColumn(task('shut', 'closed', { mergedAt: hoursAgo(1) }), NOW)).toBeNull();
	});
});

describe('board', () => {
	const projects = [
		project('wheelhouse'),
		project('docket'),
		project('casebook'),
		project('ancient'),
		project('unassigned')
	];
	const tasks = [
		at(task('build', 'working', { projectId: 'wheelhouse' }), 'building'),
		at(task('gone', 'lost', { projectId: 'wheelhouse' }), 'building'),
		task('next', 'queued', { projectId: 'wheelhouse', blockedBy: ['build'] }),
		task('merged', 'landed', { projectId: 'wheelhouse', mergedAt: hoursAgo(9) }),
		task('shape', 'needs-decision', { projectId: 'docket', attention: captain }),
		task('long-ago', 'landed', { projectId: 'ancient', mergedAt: hoursAgo(72) })
	];

	it('gives each project with work on the board a lane, its tasks in their columns', () => {
		const { lanes } = board(projects, tasks, NOW);
		const wh = lanes.find((l) => l.project.id === 'wheelhouse')!;
		expect(wh.cells.building.map((t) => t.id)).toEqual(['build', 'gone']);
		expect(wh.cells.queued.map((t) => t.id)).toEqual(['next']);
		expect(wh.cells.landed.map((t) => t.id)).toEqual(['merged']);
		expect(wh.cells.you).toEqual([]);
		expect(wh.heldUp).toBe(1);
	});

	it('puts the lanes that need the captain first', () => {
		expect(board(projects, tasks, NOW).lanes.map((l) => l.project.id)).toEqual([
			'docket',
			'wheelhouse'
		]);
	});

	it('folds projects with nothing on the board into quiet waters, by name, without unassigned', () => {
		expect(board(projects, tasks, NOW).quiet.map((p) => p.id)).toEqual(['ancient', 'casebook']);
	});

	it('gives unassigned work a lane when it has any', () => {
		const lanes = board(
			projects,
			[task('loose', 'queued', { projectId: 'unassigned' })],
			NOW
		).lanes;
		expect(lanes.map((l) => l.project.id)).toEqual(['unassigned']);
	});

	it('filters lanes by what they hold', () => {
		const { lanes } = board(projects, tasks, NOW);
		const ids = (f: string) =>
			lanes.filter((l) => laneShows(l, boardFilterOf(f))).map((l) => l.project.id);
		expect(ids('needs-you')).toEqual(['docket']);
		expect(ids('under-way')).toEqual(['wheelhouse']);
		expect(ids('queued')).toEqual(['wheelhouse']);
		expect(ids('held-up')).toEqual(['docket', 'wheelhouse']);
	});

	it('says what waits on the captain apart from the rest of the fleet', () => {
		expect(boardHeadline(board(projects, tasks, NOW).lanes)).toEqual({
			you: '1 thing waits on you',
			rest: '1 task under way in 1 project, 1 held up, 1 landed today.'
		});
		expect(boardHeadline([])).toEqual({
			you: null,
			rest: 'Nothing waits on you; nothing under way, 0 landed today.'
		});
	});
});

describe('cards', () => {
	it('say who the work waits on', () => {
		expect(cardWait(task('d', 'needs-decision', { attention: captain }), 'you', NOW).text).toBe(
			'Waiting on you'
		);
		expect(cardWait(task('q', 'queued', { blockedBy: ['a', 'b'] }), 'queued', NOW).text).toBe(
			'After a, b'
		);
		expect(cardWait(task('n', 'queued'), 'queued', NOW).text).toBe('Not started');
		expect(cardWait(task('f', 'with-firstmate'), 'building', NOW).text).toBe(
			'Waiting on Firstmate'
		);
		expect(
			cardWait(task('l', 'lost', { statusLabel: 'Lost contact' }), 'building', NOW)
		).toMatchObject({ text: 'Lost contact', tone: 'trouble' });
		expect(
			cardWait(
				task('m', 'landed', {
					pr: { url: 'https://github.com/o/r/pull/223', number: 223 } as TaskSummary['pr'],
					mergedAt: hoursAgo(9)
				}),
				'landed',
				NOW
			)
		).toMatchObject({ text: 'Merged · #223', tone: 'landed' });
	});

	it('show a line on where the work stands only when it says more than the footer', () => {
		expect(
			cardOutcome(task('q', 'queued', { summary: 'Waiting on wh-builtin-skills.' }), 'queued')
		).toBeNull();
		expect(cardOutcome(task('q', 'queued', { summary: 'Not started yet.' }), 'queued')).toBeNull();
		expect(
			cardOutcome(task('w', 'working', { summary: 'Starting a long-run sampler.' }), 'building')
		).toBe('Starting a long-run sampler.');
		expect(cardOutcome(task('d', 'needs-decision', { attention: captain }), 'you')).toBe(
			'Choose the product shape.'
		);
		expect(cardOutcome(task('m', 'landed', { summary: 'Shipped.' }), 'landed')).toBeNull();
	});
});

describe('the race', () => {
	it('measures how far a task has sailed by its column and its passage step', () => {
		expect(progress(task('q', 'queued'), 'queued')).toBe(0);
		expect(progress(at(task('b', 'working'), 'building'), 'building')).toBeCloseTo(0.2);
		expect(progress(at(task('r', 'with-reviewers'), 'review'), 'pr')).toBeCloseTo(0.8);
		expect(progress(task('m', 'landed', { mergedAt: hoursAgo(1) }), 'landed')).toBe(1);
	});

	it("puts each task on its column's leg, the furthest on rightmost, the wake to the furthest open one", () => {
		const tasks = [
			at(task('early', 'working', { projectId: 'p' }), 'building'),
			at(task('late', 'working', { projectId: 'p' }), 'checks'),
			at(task('first', 'working', { projectId: 'p' }), 'building'),
			task('merged', 'landed', { projectId: 'p', mergedAt: hoursAgo(2) })
		];
		const lane = board([project('p')], tasks, NOW).lanes[0];
		const race = course(lane, ['queued', 'building', 'pr', 'you', 'landed'], NOW);
		expect(race.legs.map((l) => l.vessels.length)).toEqual([0, 2, 1, 0, 1]);
		expect(race.legs[1].vessels.map((v) => Math.round(v.x))).toEqual([33, 67]);
		expect(race.legs[4].vessels[0]).toMatchObject({ tone: 'landed', x: 50 });
		expect(race.reach).toEqual({ leg: 2, x: 50 });
	});

	it('folds a crowded leg\'s least advanced vessels into "+n" at its start', () => {
		const tasks = ['a', 'b', 'c', 'd', 'e'].map((id) =>
			at(task(id, 'working', { projectId: 'p' }), 'building')
		);
		const lane = board([project('p')], tasks, NOW).lanes[0];
		const leg = course(lane, ['building'], NOW).legs[0];
		expect(leg.vessels).toHaveLength(3);
		expect(leg.more).toEqual({ x: 20, count: 2 });
	});

	it('has no wake when nothing is open', () => {
		const lane = board(
			[project('p')],
			[task('m', 'landed', { projectId: 'p', mergedAt: hoursAgo(2) })],
			NOW
		).lanes[0];
		expect(course(lane, ['queued', 'landed'], NOW).reach).toBeNull();
	});
});
