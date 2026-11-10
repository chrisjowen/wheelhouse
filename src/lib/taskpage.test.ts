import { describe, expect, it } from 'vitest';
import { MERGED_TABS, pickTab, stepGist, taskTabs } from './taskpage';
import type { PassageStep, TaskEvidence, TaskSummary } from './types';

const step = (o: Partial<PassageStep> = {}): PassageStep => ({
	key: 'build',
	label: 'Building',
	short: 'Build',
	state: 'done',
	note: null,
	column: 'build',
	evidence: [],
	failed: false,
	...o
});

const task = (o: Partial<TaskSummary> = {}) => ({ pr: null, ...o }) as TaskSummary;

const NONE = { available: false as const, reason: 'none' };
const ev = (o: Partial<TaskEvidence> = {}): TaskEvidence => ({
	files: NONE,
	pr: NONE,
	report: NONE,
	screenshots: NONE,
	preview: NONE,
	decisions: [],
	validation: NONE,
	...o
});
const seen = <T>(value: T) => ({ available: true as const, value, source: 's', observedAt: null });

describe('task page tabs', () => {
	const base = { preview: false, shots: 0, files: 0, docs: 0, plugins: [] };

	it('lists the Timeline first, Live preview only while one is reported, then plugins', () => {
		expect(taskTabs(base).map((t) => t.id)).toEqual(['timeline', 'changes', 'docs', 'screenshots']);
		const all = taskTabs({
			preview: true,
			shots: 3,
			files: 7,
			docs: 2,
			plugins: [{ key: 'project-links/links', title: 'Links' }]
		});
		expect(all.map((t) => t.id)).toEqual([
			'timeline',
			'preview',
			'changes',
			'docs',
			'screenshots',
			'plugin:project-links/links'
		]);
		expect(all.map((t) => t.count ?? null)).toEqual([null, null, 7, 2, 3, null]);
		expect(all.find((t) => t.id === 'plugin:project-links/links')?.label).toBe('Links');
	});

	it('opens the asked-for tab when the page has it, else the Timeline', () => {
		const tabs = taskTabs(base);
		expect(pickTab(null, tabs)).toBe('timeline');
		expect(pickTab('docs', tabs)).toBe('docs');
		// A preview tab link for a task whose preview has gone falls back to the Timeline.
		expect(pickTab('preview', tabs)).toBe('timeline');
	});

	it('sends the tabs merged into the Timeline there, the conversation’s and checks’ to their part', () => {
		const tabs = taskTabs(base);
		for (const old of ['stages', 'talk', 'checks', 'log']) {
			expect(pickTab(old, tabs)).toBe('timeline');
		}
		expect(MERGED_TABS.talk).toEqual({ strand: 'talk' });
		expect(MERGED_TABS.checks).toEqual({ anchor: 'checks' });
	});
});

describe('stages', () => {
	it('folds a finished stage to what its evidence came to', () => {
		const e = ev({
			files: seen({
				base: 'main',
				mergeBase: 'x',
				branch: 'b',
				files: [],
				total: 4,
				truncated: false
			}),
			pr: seen({
				url: 'https://github.com/o/r/pull/7',
				number: 7,
				state: 'merged',
				draft: false,
				reviewDecision: null,
				checks: []
			}),
			screenshots: seen([{ name: 'a.png', url: '/a.png', modifiedAt: '' }])
		});
		expect(stepGist(step({ evidence: ['files'] }), task(), e)).toBe('4 files changed');
		expect(stepGist(step({ evidence: ['pr', 'screenshots'] }), task(), e)).toBe(
			'Pull request #7 merged · 1 screenshot'
		);
		expect(stepGist(step({ evidence: ['validation'] }), task(), e)).toBe('Checks passed');
		expect(stepGist(step({ evidence: ['validation'], state: 'current' }), task(), e)).toBeNull();
	});

	it('falls back to the note, and says nothing for stages not reached', () => {
		expect(stepGist(step({ note: 'Queued behind wh-2' }), task(), ev())).toBe('Queued behind wh-2');
		expect(stepGist(step({ state: 'upcoming', note: 'x' }), task(), ev())).toBeNull();
		expect(stepGist(step({ state: 'skipped', note: 'Not needed' }), task(), ev())).toBe(
			'Not needed'
		);
		// The PR known only from the summary still gets a line.
		const t = task({
			pr: { url: 'https://github.com/o/r/pull/9', number: 9 } as TaskSummary['pr']
		});
		expect(stepGist(step({ evidence: ['pr'] }), t, ev())).toBe('Pull request #9');
	});
});
