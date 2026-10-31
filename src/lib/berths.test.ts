import { describe, expect, it } from 'vitest';
import {
	berth,
	byAttention,
	dayCounts,
	fleetHeadline,
	projectLine,
	shows,
	stateOf
} from './berths';
import type { PassageStep, Project, TaskSummary } from './types';
import { taskSummary } from '../../tests/helpers/task-summary';

const NOW = Date.parse('2026-10-30T12:00:00Z');
const hoursAgo = (h: number) => new Date(NOW - h * 3600_000).toISOString();
const you = {
	kind: 'review' as const,
	owner: 'captain' as const,
	text: 'Pull request #7 is ready for your review.',
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

const step = (key: string, failed = false): PassageStep => ({
	key,
	label: key,
	short: key,
	state: 'upcoming',
	note: null,
	column: key,
	evidence: [],
	failed
});

const at = (t: TaskSummary, current: number, failed = false): TaskSummary => ({
	...t,
	passage: {
		...t.passage,
		steps: ['Queued', 'Building', 'Checks', 'Pull request'].map((k, i) =>
			step(k, failed && i === current)
		),
		current
	}
});

describe('berth', () => {
	it('sorts a project’s work into your move, held up, moving, queued and landed', () => {
		const b = berth(
			project('lumen'),
			[
				taskSummary('review', 'needs-review', { attention: you, pr: { url: 'u', number: 7 } }),
				taskSummary('stuck', 'blocked'),
				at(taskSummary('deploy', 'working'), 2, true),
				at(taskSummary('build', 'working', { pr: { url: 'v', number: 8 } }), 1),
				taskSummary('asked', 'with-firstmate'),
				taskSummary('next', 'queued'),
				taskSummary('new', 'landed', { mergedAt: hoursAgo(3) }),
				taskSummary('old', 'landed', { mergedAt: hoursAgo(24 * 3) }),
				taskSummary('ancient', 'landed', { mergedAt: hoursAgo(24 * 30) }),
				taskSummary('dropped', 'done')
			],
			NOW
		);
		const ids = (ts: TaskSummary[]) => ts.map((t) => t.id);
		expect(b.state).toBe('needs-you');
		expect(ids(b.yourMove)).toEqual(['review']);
		expect(ids(b.heldUp)).toEqual(['stuck', 'deploy']);
		expect(ids(b.moving)).toEqual(['build', 'asked']);
		expect(ids(b.queued)).toEqual(['next']);
		expect(ids(b.landed)).toEqual(['new', 'old']);
		expect(b.lastLanded?.id).toBe('new');
		expect(b.landings).toHaveLength(3);
		expect(b.openPullRequests).toBe(2);
		expect(b.underWay).toBe(4);
	});

	it('is held up by stuck work or a passage file with problems, quiet with nothing open', () => {
		expect(berth(project('a'), [taskSummary('x', 'lost')], NOW).state).toBe('held-up');
		const broken = project('b', { passage: { custom: true, problems: 2, needsConsent: false } });
		expect(berth(broken, [], NOW).state).toBe('held-up');
		expect(berth(project('c'), [taskSummary('x', 'queued')], NOW).state).toBe('under-way');
		const quiet = berth(
			project('d'),
			[taskSummary('x', 'landed', { mergedAt: hoursAgo(400) })],
			NOW
		);
		expect(quiet.state).toBe('quiet');
		expect(quiet.landed).toEqual([]);
		expect(quiet.lastLanded?.id).toBe('x');
		expect(berth(project('e'), [], NOW).lastActivity).toBeNull();
	});

	it('is new when its first work is from the last two weeks and nothing is finished yet', () => {
		const fresh = taskSummary('x', 'working', { since: hoursAgo(24 * 3) });
		expect(berth(project('a'), [fresh], NOW).state).toBe('new');
		const old = taskSummary('y', 'queued', { since: hoursAgo(24 * 20) });
		expect(berth(project('b'), [fresh, old], NOW).state).toBe('under-way');
		const finished = taskSummary('z', 'done', { since: hoursAgo(24 * 2) });
		expect(berth(project('c'), [fresh, finished], NOW).state).toBe('under-way');
		expect(berth(project('d'), [taskSummary('x', 'working')], NOW).state).toBe('under-way');
		const stuck = taskSummary('s', 'blocked', { since: hoursAgo(1) });
		expect(berth(project('e'), [fresh, stuck], NOW).state).toBe('held-up');
	});
});

describe('projectLine', () => {
	const line = (p: Project, tasks: TaskSummary[]) => projectLine(berth(p, tasks, NOW), NOW);
	it('says the one thing that matters most, in plain words', () => {
		expect(
			line(project('a'), [
				taskSummary('Vault page', 'needs-review', { attention: you }),
				taskSummary('x', 'blocked')
			])
		).toBe('Vault page: Pull request #7 is ready for your review.');
		expect(
			line(project('a'), [taskSummary('Gateway', 'lost', { statusLabel: 'Lost contact' })])
		).toBe('Gateway: Lost contact.');
		expect(
			line(project('a', { passage: { custom: true, problems: 1, needsConsent: false } }), [])
		).toBe('Its passage file has problems.');
		expect(line(project('a'), [at(taskSummary('Search', 'working'), 1)])).toBe(
			'Search is at Building.'
		);
		expect(
			line(project('a'), [
				at(
					taskSummary('Search', 'working', {
						activity: { text: 'Writing the tests', at: null, source: 'status' }
					}),
					1
				)
			])
		).toBe('Search: Writing the tests.');
		expect(line(project('a'), [taskSummary('Export', 'landed', { mergedAt: hoursAgo(5) })])).toBe(
			'Nothing under way. Export landed 5 h ago.'
		);
		expect(line(project('a'), [])).toBe('No work yet.');
	});
	it('says how long something has waited on you or been held up', () => {
		expect(
			line(project('a'), [
				taskSummary('Vault page', 'needs-review', {
					attention: you,
					since: hoursAgo(30),
					activity: { text: 'Ready', at: hoursAgo(3), source: 'status' }
				})
			])
		).toBe('Vault page: Pull request #7 is ready for your review. Waiting for 3 h.');
		expect(
			line(project('a'), [
				taskSummary('Gateway', 'blocked', { statusLabel: 'Blocked', since: hoursAgo(24 * 3) })
			])
		).toBe('Gateway: Blocked. Held up for 3 days.');
	});
});

describe('byAttention and stateOf', () => {
	it('puts what needs you first, then held up, new, under way and quiet, the busiest first', () => {
		const old = taskSummary('o', 'landed', { mergedAt: hoursAgo(24 * 30) });
		const list = [
			berth(project('quiet'), [], NOW),
			berth(project('fresh'), [taskSummary('a', 'queued', { since: hoursAgo(20) })], NOW),
			berth(project('busy-old'), [taskSummary('a', 'working', { since: hoursAgo(9) }), old], NOW),
			berth(project('busy-new'), [taskSummary('a', 'working', { since: hoursAgo(1) }), old], NOW),
			berth(project('stuck'), [taskSummary('a', 'blocked')], NOW),
			berth(project('yours'), [taskSummary('a', 'needs-review', { attention: you })], NOW)
		];
		expect(byAttention(list).map((b) => b.project.id)).toEqual([
			'yours',
			'stuck',
			'fresh',
			'busy-new',
			'busy-old',
			'quiet'
		]);
	});
	it('reads a filter from the address, and nothing else', () => {
		expect(stateOf('held-up')).toBe('held-up');
		expect(stateOf('everything')).toBeNull();
		expect(stateOf(null)).toBeNull();
		expect(stateOf('new')).toBeNull();
	});
	it('shows a new project under Under way, and every project under All', () => {
		expect(shows('new', 'under-way')).toBe(true);
		expect(shows('new', null)).toBe(true);
		expect(shows('new', 'quiet')).toBe(false);
		expect(shows('under-way', 'under-way')).toBe(true);
		expect(shows('quiet', 'held-up')).toBe(false);
	});
});

describe('fleetHeadline', () => {
	it('counts projects (not odd jobs), what needs you, what is under way and what landed', () => {
		const list = [
			berth(
				project('a'),
				[taskSummary('r', 'needs-review', { attention: you }), taskSummary('w', 'working')],
				NOW
			),
			berth(
				project('b'),
				[taskSummary('s', 'blocked'), taskSummary('l', 'landed', { mergedAt: hoursAgo(2) })],
				NOW
			),
			berth(
				project('unassigned', { registered: false }),
				[taskSummary('x', 'landed', { mergedAt: hoursAgo(1) })],
				NOW
			)
		];
		expect(fleetHeadline(list)).toBe(
			'2 projects. 1 thing needs you; 2 under way, 1 of them held up; 2 landed this week.'
		);
		expect(fleetHeadline([berth(project('a'), [], NOW)])).toBe(
			'1 project. Nothing needs you; nothing under way; nothing landed this week.'
		);
	});
});

describe('dayCounts', () => {
	it('counts times per local day over the last days, oldest first, ignoring the rest', () => {
		const now = new Date(2026, 9, 30, 15, 0).getTime();
		const day = (d: number, h = 12) => new Date(2026, 9, d, h, 0).getTime();
		expect(
			dayCounts([day(30, 9), day(30, 1), day(29), day(17), day(16), now + 3600_000], now, 14)
		).toEqual([1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2]);
	});
});
