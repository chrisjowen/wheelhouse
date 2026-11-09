import { describe, expect, it } from 'vitest';
import { berth, byAttention } from './berths';
import { fleetChart, PER_LANE } from './fleetchart';
import type { Project, TaskSummary } from './types';
import { taskSummary } from '../../tests/helpers/task-summary';

const NOW = Date.parse('2026-10-30T12:00:00Z');
const hoursAgo = (h: number) => new Date(NOW - h * 3600_000).toISOString();
const project = (id: string): Project => ({
	id,
	name: id,
	description: null,
	posture: null,
	registered: true,
	path: null,
	passage: null
});
const task = (
	id: string,
	projectId: string,
	status: TaskSummary['status'],
	o: Partial<TaskSummary> = {}
) => taskSummary(id, status, { projectId, ...o });
const captain = {
	attention: {
		kind: 'review' as const,
		owner: 'captain' as const,
		text: 'Ready for your review.',
		url: null
	}
};

function chart(projects: Project[], tasks: TaskSummary[]) {
	const berths = byAttention(
		projects.map((p) =>
			berth(
				p,
				tasks.filter((t) => t.projectId === p.id),
				NOW
			)
		)
	);
	return fleetChart(berths, tasks, NOW);
}

describe('the fleet chart', () => {
	it('gives each project with work a row, most pressing first', () => {
		const c = chart(
			[project('alpha'), project('beta'), project('calm')],
			[task('a1', 'alpha', 'working'), task('b1', 'beta', 'needs-review', captain)]
		);
		expect(c.rows.map((r) => r.project.id)).toEqual(['beta', 'alpha']);
	});

	it('sits each vessel in its lane, spreading a lane’s vessels evenly', () => {
		const c = chart(
			[project('alpha')],
			[
				task('q', 'alpha', 'queued'),
				task('w1', 'alpha', 'working'),
				task('w2', 'alpha', 'working'),
				task('l', 'alpha', 'landed', { mergedAt: hoursAgo(2) })
			]
		);
		const x = Object.fromEntries(c.rows[0].vessels.map((v) => [v.blip.id, v.x]));
		// Five lanes of 20: Queued 0–20, Building 20–40, …, Landed 80–100.
		expect(x.q).toBeCloseTo(10);
		const [first, second] = [x.w1, x.w2].sort((a, b) => a - b);
		expect(first).toBeCloseTo(20 + 20 / 3);
		expect(second).toBeCloseTo(20 + 40 / 3);
		expect(x.l).toBeCloseTo(90);
		// The wake runs to the furthest open vessel, never to what has landed.
		expect(c.rows[0].reach).toBeCloseTo(20 + 40 / 3);
	});

	it('folds a crowded lane into "+n" after the first few', () => {
		const many = Array.from({ length: PER_LANE + 3 }, (_, i) => task(`w${i}`, 'alpha', 'working'));
		const [row] = chart([project('alpha')], many).rows;
		expect(row.vessels).toHaveLength(PER_LANE);
		expect(row.more).toEqual([{ x: expect.any(Number), count: 3 }]);
		expect(row.more[0].x).toBeGreaterThan(Math.max(...row.vessels.map((v) => v.x)));
		expect(row.more[0].x).toBeLessThan(40);
	});

	it('labels only the most pressing call on the captain in each row', () => {
		const [row] = chart(
			[project('alpha')],
			[
				task('moving', 'alpha', 'working'),
				task('stuck', 'alpha', 'blocked'),
				task('yours', 'alpha', 'needs-review', captain)
			]
		).rows;
		expect(row.labelled).toBe('yours');
		const [calm] = chart([project('alpha')], [task('moving', 'alpha', 'working')]).rows;
		expect(calm.labelled).toBeNull();
	});

	it('leaves out work that landed over a day ago or closed unmerged', () => {
		const c = chart(
			[project('alpha')],
			[task('old', 'alpha', 'landed', { mergedAt: hoursAgo(30) }), task('shut', 'alpha', 'closed')]
		);
		expect(c.rows).toEqual([]);
	});

	it('marks the second mates whose work is on a row', () => {
		const mate = { id: 'hostinger', host: 'vps', where: 'remote' as const };
		const [row] = chart(
			[project('docket')],
			[
				task('hook@hostinger', 'docket', 'working', { secondMate: mate }),
				task('page@hostinger', 'docket', 'queued', { secondMate: mate }),
				task('local', 'docket', 'working')
			]
		).rows;
		expect(row.mates).toEqual([mate]);
	});

	it('marks a second mate whose work is folded into "+n"', () => {
		const mate = { id: 'hostinger', host: 'vps', where: 'remote' as const };
		const local = Array.from({ length: PER_LANE }, (_, i) => task(`a${i}`, 'docket', 'working'));
		const [row] = chart(
			[project('docket')],
			[...local, task('z@hostinger', 'docket', 'working', { secondMate: mate })]
		).rows;
		expect(row.vessels.map((v) => v.blip.id)).not.toContain('z@hostinger');
		expect(row.more).toEqual([{ x: expect.any(Number), count: 1 }]);
		expect(row.mates).toEqual([mate]);
	});
});
