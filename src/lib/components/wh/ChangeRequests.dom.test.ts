import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import type { ChangeRequest, PassageStep, TaskRun, TaskRuns } from '$lib/types';
import ChangeRequests from './ChangeRequests.svelte';
import PastRun from './PastRun.svelte';
import RunSwitcher from './RunSwitcher.svelte';

const req = (o: Partial<ChangeRequest> = {}): ChangeRequest => ({
	id: 'x',
	source: 'github',
	kind: 'thread',
	author: 'captain',
	text: 'Rename the helper',
	at: '2026-10-27T10:00:00Z',
	url: 'https://github.com/o/r/pull/2#discussion_r1',
	where: { path: 'src/a.ts', line: 7 },
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
const RUNS: TaskRuns = {
	current: 2,
	reworking: true,
	runs: [
		run({
			n: 1,
			startedAt: '2026-10-27T08:00:00Z',
			readyAt: '2026-10-27T09:05:00Z',
			endedAt: '2026-10-27T10:00:00Z',
			outcome: 'changes-requested'
		}),
		run({
			n: 2,
			startedAt: '2026-10-27T10:00:00Z',
			basis: 'You asked for changes on GitHub after run 1 was reported ready.',
			changes: [
				req({ id: 'a' }),
				req({
					id: 'b',
					source: 'wheelhouse',
					kind: 'preview',
					author: null,
					url: null,
					where: null,
					text: 'Bigger button',
					state: 'addressed'
				})
			]
		})
	]
};

let app: ReturnType<typeof mount> | null = null;
afterEach(() => {
	if (app) unmount(app);
	app = null;
	document.body.innerHTML = '';
});

describe('ChangeRequests', () => {
	it('lists the changes that started a run with file, line and GitHub link, and folds the done ones', () => {
		app = mount(ChangeRequests, { target: document.body, props: { run: RUNS.runs[1] } });
		flushSync();
		const section = document.querySelector('[data-changes]')!;
		expect(section.getAttribute('data-changes')).toBe('active');
		expect(section.querySelector('h2')!.textContent).toContain('Run 2 started with these changes');
		expect(section.textContent).toContain('It is the worker’s turn');
		const open = document.querySelectorAll('[data-change="open"]');
		expect(open).toHaveLength(1);
		expect(open[0].textContent).toContain('src/a.ts, line 7');
		expect(open[0].querySelector('a')!.getAttribute('href')).toBe(
			'https://github.com/o/r/pull/2#discussion_r1'
		);
		expect(document.querySelectorAll('[data-change="addressed"]')).toHaveLength(0);
		[...document.querySelectorAll('button')].find((b) => b.textContent?.includes('done'))!.click();
		flushSync();
		const done = document.querySelector('[data-change="addressed"]')!;
		expect(done.textContent).toContain('Preview feedback');
		expect(done.textContent).toContain('Worker reported it ready since');
	});
});

describe('RunSwitcher', () => {
	it('lists every run with how it went, and picks one', () => {
		let picked = 0;
		app = mount(RunSwitcher, {
			target: document.body,
			props: { runs: RUNS, selected: 2, onselect: (n: number) => (picked = n) }
		});
		flushSync();
		const buttons = [...document.querySelectorAll<HTMLButtonElement>('[data-run]')];
		expect(buttons.map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'true']);
		expect(buttons[0].textContent).toContain('Run 1');
		expect(buttons[0].textContent).toContain('Built in 1h 5m · 2 changes requested');
		expect(buttons[1].textContent).toContain('Run 2 · current');
		buttons[0].click();
		expect(picked).toBe(1);
	});
});

describe('PastRun', () => {
	it('shows an earlier run’s stages, checks, screenshots and how it ended', () => {
		const steps = [
			{ key: 'queued', label: 'Queued', state: 'done' },
			{ key: 'building', label: 'Building', state: 'current' },
			{ key: 'checks', label: 'Checks', state: 'upcoming' },
			{ key: 'landed', label: 'Landed', state: 'upcoming' }
		] as PassageStep[];
		app = mount(PastRun, {
			target: document.body,
			props: {
				run: RUNS.runs[0],
				runs: RUNS,
				steps,
				validations: [
					{
						id: '01ABCDEF',
						startedAt: '2026-10-27T08:30:00Z',
						outcome: 'passed',
						text: 'All checks passed'
					}
				],
				shots: [{ name: 'before.png', url: '/a/before.png' }],
				onshot: () => {}
			}
		});
		flushSync();
		const text = document.querySelector('[data-past-run="1"]')!.textContent!;
		expect(text).toContain('Queued');
		expect(text).toContain('Checks');
		expect(text).not.toContain('Landed');
		expect(text).toContain('1h 5m');
		expect(text).toContain('All checks passed');
		expect(text).toContain('before.png');
		expect(text).toContain('Changes requested (2 requests), so run 2 began');
	});
});
