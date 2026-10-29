import { describe, expect, it } from 'vitest';
import {
	BOARD_VIEWS,
	nextSort,
	postureWords,
	projectStats,
	PROJECTS_VIEWS,
	sortProjects,
	sortTasks,
	updatedAt,
	viewOf,
	waitingOn
} from './views';
import type { PassageStep, Project, TaskStatus, TaskSummary } from './types';

const NO_DECLARED = { custom: false, live: null, link: null, checks: [] };

const step = (key: string, column = key): PassageStep => ({
	key,
	label: key,
	short: key,
	state: 'upcoming',
	note: null,
	column,
	evidence: [],
	failed: false
});

function task(id: string, status: TaskStatus, o: Partial<TaskSummary> = {}): TaskSummary {
	return {
		id,
		title: id,
		shortTitle: id,
		projectId: 'p',
		kind: 'ship',
		track: 'ship',
		status,
		statusLabel: status,
		summary: null,
		summaryIsHistory: false,
		summaryRaw: null,
		activity: null,
		busy: false,
		pipeline: null,
		filesChanged: null,
		worker: null,
		branch: null,
		passage: {
			track: 'ship',
			steps: [step('queued'), step('building')],
			current: 0,
			basis: '',
			...NO_DECLARED
		},
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
		shots: [],
		...o
	};
}

const NOW = Date.parse('2026-10-26T12:00:00Z');
const hoursAgo = (h: number) => new Date(NOW - h * 3600_000).toISOString();
const you = { kind: 'review' as const, owner: 'captain' as const, text: '', url: null };

describe('viewOf', () => {
	it('keeps a known layout and falls back to the first', () => {
		expect(viewOf('compact', BOARD_VIEWS)).toBe('compact');
		expect(viewOf('list', BOARD_VIEWS)).toBe('list');
		expect(viewOf('bogus', BOARD_VIEWS)).toBe('large');
		expect(viewOf(undefined, BOARD_VIEWS)).toBe('large');
		expect(viewOf('list', PROJECTS_VIEWS)).toBe('list');
		expect(viewOf('compact', PROJECTS_VIEWS)).toBe('cards');
	});
});

describe('nextSort', () => {
	it('flips the same column and starts a new one at its own direction', () => {
		expect(nextSort({ key: 'task', dir: 'asc' }, 'task', 'asc')).toEqual({
			key: 'task',
			dir: 'desc'
		});
		expect(nextSort({ key: 'task', dir: 'asc' }, 'updated', 'desc')).toEqual({
			key: 'updated',
			dir: 'desc'
		});
	});
});

describe('waitingOn', () => {
	it('names who each task waits on', () => {
		expect(waitingOn(task('a', 'needs-review', { attention: you })).label).toBe('You: review');
		expect(
			waitingOn(task('a', 'needs-decision', { attention: { ...you, kind: 'decision' } })).label
		).toBe('You: decision');
		expect(waitingOn(task('a', 'with-firstmate')).who).toBe('firstmate');
		expect(
			waitingOn(task('a', 'with-reviewers', { attention: { ...you, owner: 'reviewers' } }))
		).toEqual({ who: 'reviewers', label: 'Reviewers' });
		expect(waitingOn(task('a', 'blocked')).who).toBe('firstmate');
		expect(waitingOn(task('a', 'working')).who).toBe('crew');
		expect(waitingOn(task('a', 'queued', { blockedBy: ['x', 'y'] })).label).toBe('2 earlier tasks');
		expect(waitingOn(task('a', 'queued')).label).toBe('Its turn');
		expect(waitingOn(task('a', 'landed')).who).toBe('nobody');
	});
});

describe('updatedAt', () => {
	it('takes the newest of the activity and when it started, not the crew read', () => {
		const t = task('a', 'working', {
			since: hoursAgo(5),
			activity: { text: '', at: hoursAgo(1), source: 'status' },
			current: {
				state: 'working',
				source: null,
				detail: null,
				observedAt: hoursAgo(0),
				fresh: true
			}
		});
		expect(updatedAt(t)).toBe(NOW - 3600_000);
		expect(updatedAt(task('a', 'queued'))).toBeNull();
	});
});

describe('sortTasks', () => {
	const tasks = [
		task('bravo', 'working', { projectId: 'b', since: hoursAgo(2) }),
		task('alpha', 'landed', { projectId: 'a', mergedAt: hoursAgo(30) }),
		task('charlie', 'needs-review', { projectId: 'c', attention: you, since: hoursAgo(1) }),
		task('delta', 'blocked', { projectId: 'a', since: hoursAgo(3) })
	];
	const name = (t: TaskSummary) => t.projectId;
	const ids = (k: Parameters<typeof sortTasks>[1]) => sortTasks(tasks, k, name).map((t) => t.id);

	it('sorts by name either way', () => {
		expect(ids({ key: 'task', dir: 'asc' })).toEqual(['alpha', 'bravo', 'charlie', 'delta']);
		expect(ids({ key: 'task', dir: 'desc' })).toEqual(['delta', 'charlie', 'bravo', 'alpha']);
	});
	it('puts the most pressing status first, then who it waits on', () => {
		expect(ids({ key: 'status', dir: 'asc' })).toEqual(['charlie', 'delta', 'bravo', 'alpha']);
		expect(ids({ key: 'waiting', dir: 'asc' })).toEqual(['charlie', 'delta', 'bravo', 'alpha']);
	});
	it('sorts by project, breaking ties by what is most pressing', () => {
		expect(ids({ key: 'project', dir: 'asc' })).toEqual(['delta', 'alpha', 'bravo', 'charlie']);
	});
	it('puts the newest first when sorting by update', () => {
		expect(ids({ key: 'updated', dir: 'desc' })).toEqual(['charlie', 'bravo', 'delta', 'alpha']);
	});
	it('sorts by how far along the passage each task is', () => {
		const far = task('far', 'working', {
			passage: { ...task('x', 'working').passage, current: 1 }
		});
		expect(sortTasks([tasks[0], far], { key: 'stage', dir: 'desc' }, name)[0].id).toBe('far');
	});
});

describe('projectStats', () => {
	it('counts work under way, what needs you and what landed this week', () => {
		const s = projectStats(
			[
				task('a', 'working', { since: hoursAgo(2) }),
				task('b', 'with-firstmate'),
				task('c', 'needs-review', { attention: you }),
				task('d', 'landed', { mergedAt: hoursAgo(30) }),
				task('e', 'landed', { mergedAt: hoursAgo(24 * 10) }),
				task('f', 'queued')
			],
			NOW
		);
		expect(s).toEqual({
			underWay: 2,
			needsYou: 1,
			landed: 1,
			queued: 1,
			lastActivity: NOW - 2 * 3600_000
		});
		expect(projectStats([], NOW).lastActivity).toBeNull();
	});
});

describe('postureWords', () => {
	const words = (posture: string | null, registered = true) =>
		postureWords({ posture, registered });
	it('says how changes ship and who merges', () => {
		expect(words('no-mistakes-prod-only +yolo')).toEqual({
			ships:
				'Product changes run the full checks; internal tooling goes straight to a pull request',
			merges: 'Firstmate merges once checks are green',
			short: 'Full checks for product work · Firstmate merges'
		});
		expect(words('direct-PR')?.short).toBe('Straight to PR · you merge');
		expect(words('direct-PR')?.merges).toBe('You merge each pull request');
		expect(words('local-only')?.ships).toMatch(/no pull request/);
		expect(words('local-only +yolo')?.short).toBe('Local only · you approve');
		expect(words('no-mistakes forge=gerrit')?.ships).toMatch(/on Gerrit$/);
	});
	it('reads a legacy entry as the full checks, and an unknown mode as written', () => {
		expect(words(null)?.ships).toMatch(/^Every change runs the full checks/);
		expect(words('prod')?.ships).toBe('Ships as "prod"');
		expect(words(null, false)).toBeNull();
	});
});

describe('sortProjects', () => {
	const p = (id: string): Project => ({
		id,
		name: id,
		description: null,
		posture: null,
		registered: true,
		path: null,
		passage: null
	});
	const stats = { a: 1, b: 3, c: 3 } as Record<string, number>;
	const s = (x: Project) => ({
		underWay: stats[x.id],
		needsYou: 0,
		landed: 0,
		queued: 0,
		lastActivity: null
	});
	it('sorts by a count, ties by name', () => {
		expect(
			sortProjects([p('a'), p('c'), p('b')], s, { key: 'underWay', dir: 'desc' }).map((x) => x.id)
		).toEqual(['b', 'c', 'a']);
		expect(sortProjects([p('b'), p('a')], s, { key: 'name', dir: 'asc' }).map((x) => x.id)).toEqual(
			['a', 'b']
		);
	});
});
