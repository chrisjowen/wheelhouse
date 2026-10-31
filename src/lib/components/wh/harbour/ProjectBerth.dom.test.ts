import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { berth } from '$lib/berths';
import { projectLabels } from '$lib/projectnames';
import type { Project, TaskSummary } from '$lib/types';
import { taskSummary } from '../../../../../tests/helpers/task-summary';
import ProjectBerth from './ProjectBerth.svelte';

/** A project's card on the Harbour, drawn from its work. */

const NOW = Date.parse('2026-10-30T12:00:00Z');
const hoursAgo = (h: number) => new Date(NOW - h * 3600_000).toISOString();
const project = (o: Partial<Project> = {}): Project => ({
	id: 'lumen',
	name: 'lumen',
	description: null,
	posture: null,
	registered: true,
	path: null,
	passage: null,
	...o
});

let app: ReturnType<typeof mount> | null = null;
function draw(tasks: TaskSummary[], p = project()) {
	app = mount(ProjectBerth, {
		target: document.body,
		props: {
			berth: berth(p, tasks, NOW),
			label: projectLabels([p]).get(p.id),
			commits: null,
			now: NOW
		}
	});
	flushSync();
}
const text = () => document.body.textContent?.replace(/\s+/g, ' ') ?? '';
const link = (name: string) =>
	[...document.querySelectorAll('a')].find((a) => a.textContent?.includes(name));

beforeEach(() => (document.body.innerHTML = ''));
afterEach(() => {
	if (app) unmount(app);
	app = null;
});

describe('a project’s card', () => {
	it('says what waits on you, what is moving and what landed, and opens the project', () => {
		draw([
			taskSummary('Vault page', 'needs-review', {
				attention: {
					kind: 'review',
					owner: 'captain',
					text: 'Pull request #7 is ready for your review.',
					url: null
				},
				since: hoursAgo(2)
			}),
			taskSummary('Gateway', 'working'),
			taskSummary('Search', 'landed', { mergedAt: hoursAgo(3) })
		]);
		expect(text()).toContain('Needs you');
		expect(link('Review: Vault page')?.getAttribute('href')).toBe('/tasks/Vault%20page');
		expect(text()).toContain('Pull request #7 is ready for your review. Waiting for 2 h.');
		expect(link('Gateway')?.getAttribute('href')).toBe('/tasks/Gateway');
		expect(text()).toContain('1 landed this week. Latest: Search, 3 h ago.');
		expect(link('lumen')?.getAttribute('href')).toBe('/projects/lumen');
	});

	it('leads with stuck work, or a passage file with problems, when nothing waits on you', () => {
		draw([taskSummary('Flaky checks', 'lost', { statusLabel: 'Lost contact' })]);
		expect(text()).toContain('Held up');
		expect(link('Flaky checks')?.textContent).toContain('Lost contact.');
		unmount(app!);
		document.body.innerHTML = '';
		draw([taskSummary('Flaky checks', 'blocked', { statusLabel: 'Blocked', since: hoursAgo(5) })]);
		expect(link('Flaky checks')?.textContent).toContain('Blocked. Held up for 5 h.');
		unmount(app!);
		document.body.innerHTML = '';
		draw([
			taskSummary('Schema', 'needs-review', {
				attention: {
					kind: 'decision',
					owner: 'captain',
					text: 'Needs a call on the schema',
					url: null
				},
				since: hoursAgo(4)
			})
		]);
		expect(link('Decide: Schema')?.textContent).toContain(
			'Needs a call on the schema. Waiting for 4 h.'
		);
		unmount(app!);
		document.body.innerHTML = '';
		draw([], project({ passage: { custom: true, problems: 1, needsConsent: false } }));
		expect(link('passage file has problems')?.getAttribute('href')).toBe('/projects/lumen/passage');
		expect(text()).toContain('Nothing under way.');
		expect(text()).toContain('Nothing has landed yet.');
	});
});
