import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { berth, byAttention } from '$lib/berths';
import { fleetChart } from '$lib/fleetchart';
import { projectLabels } from '$lib/projectnames';
import type { Project, TaskSummary } from '$lib/types';
import { taskSummary } from '../../../../../tests/helpers/task-summary';
import FleetChart from './FleetChart.svelte';

/** The fleet chart at the top of the Harbour's Projects view. */

const NOW = Date.parse('2026-10-30T12:00:00Z');
const project = (id: string): Project => ({
	id,
	name: id,
	description: null,
	posture: null,
	registered: true,
	path: null,
	passage: null
});

let app: ReturnType<typeof mount> | null = null;
function draw(projects: Project[], tasks: TaskSummary[]) {
	const berths = byAttention(
		projects.map((p) =>
			berth(
				p,
				tasks.filter((t) => t.projectId === p.id),
				NOW
			)
		)
	);
	const props = $state({ chart: fleetChart(berths, tasks, NOW), labels: projectLabels(projects) });
	app = mount(FleetChart, { target: document.body, props });
	flushSync();
	return props;
}
const vessel = (id: string) => document.querySelector<HTMLAnchorElement>(`[data-vessel="${id}"]`)!;
const tag = (id: string) => vessel(id).querySelector<HTMLElement>('[data-vessel-tag]')!;

beforeEach(() => (document.body.innerHTML = ''));
afterEach(() => {
	if (app) unmount(app);
	app = null;
});

describe('the fleet chart', () => {
	it('draws a line per busy project, each vessel opening its task and each name its project', () => {
		draw(
			[project('alpha'), project('beta'), project('calm')],
			[
				taskSummary('gateway', 'working', { projectId: 'alpha', busy: true }),
				taskSummary('search', 'queued', { projectId: 'beta' })
			]
		);
		const rows = [...document.querySelectorAll('[data-chart-row]')].map((r) =>
			r.getAttribute('data-chart-row')
		);
		expect(rows.sort()).toEqual(['alpha', 'beta']);
		expect(vessel('gateway').getAttribute('href')).toBe('/tasks/gateway');
		expect(vessel('gateway').getAttribute('aria-label')).toBe('gateway: Building, working now');
		const name = document.querySelector('[data-chart-row="alpha"] a')!;
		expect(name.getAttribute('href')).toBe('/projects/alpha');
	});

	it('names only what waits on the captain without hovering', () => {
		draw(
			[project('alpha')],
			[
				taskSummary('gateway', 'working', { projectId: 'alpha' }),
				taskSummary('vault', 'needs-review', {
					projectId: 'alpha',
					attention: { kind: 'review', owner: 'captain', text: 'Ready.', url: null }
				})
			]
		);
		expect(tag('vault').dataset.vesselTag).toBe('standing');
		expect(tag('vault').textContent).toContain('waiting on you');
		expect(tag('gateway').dataset.vesselTag).toBe('hover');
		expect(tag('gateway').className).toContain('hidden');
	});

	it('marks a second mate’s work on its vessel and its project', () => {
		draw(
			[project('docket')],
			[
				taskSummary('hook@hostinger', 'working', {
					projectId: 'docket',
					secondMate: { id: 'hostinger', host: 'vps', where: 'remote' }
				})
			]
		);
		expect(vessel('hook@hostinger').getAttribute('href')).toBe('/tasks/hook%40hostinger');
		expect(vessel('hook@hostinger').getAttribute('aria-label')).toContain(
			'on second mate hostinger'
		);
		const mark = document.querySelector('[data-chart-mate="hostinger"]')!;
		expect(mark.getAttribute('title')).toBe('Work on second mate hostinger, on vps');
	});

	it('moves a vessel to its new lane in place when its work moves on', () => {
		const tasks = [taskSummary('gateway', 'queued', { projectId: 'alpha' })];
		const props = draw([project('alpha')], tasks);
		const before = vessel('gateway');
		const left = () => before.parentElement!.style.left;
		expect(parseFloat(left())).toBeCloseTo(10);
		const moved = [taskSummary('gateway', 'working', { projectId: 'alpha' })];
		props.chart = fleetChart([berth(project('alpha'), moved, NOW)], moved, NOW);
		flushSync();
		// The same element, so it glides rather than reappearing.
		expect(vessel('gateway')).toBe(before);
		expect(parseFloat(left())).toBeCloseTo(30);
	});
});
