import { describe, expect, it } from 'vitest';
import { feedbackNote } from './preview';
import { hasDetail, openByDefault, pickTab, previewThread, stepGist, taskTabs } from './taskpage';
import type { BridgeMessage, PassageStep, TaskEvidence, TaskSummary } from './types';

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
	it('lists Stages first, Live preview only while one is reported, and Log last', () => {
		const base = { preview: false, shots: 0, plugins: [] };
		expect(taskTabs(base).map((t) => t.id)).toEqual(['stages', 'screenshots', 'log']);
		const all = taskTabs({
			preview: true,
			shots: 3,
			plugins: [{ key: 'project-links/links', title: 'Links' }]
		});
		expect(all.map((t) => t.id)).toEqual([
			'stages',
			'preview',
			'screenshots',
			'plugin:project-links/links',
			'log'
		]);
		expect(all.find((t) => t.id === 'screenshots')?.count).toBe(3);
		expect(all.find((t) => t.id === 'plugin:project-links/links')?.label).toBe('Links');
	});

	it('opens the asked-for tab when the page has it, else Stages', () => {
		const tabs = taskTabs({ preview: false, shots: 0, plugins: [] });
		expect(pickTab(null, tabs)).toBe('stages');
		expect(pickTab('log', tabs)).toBe('log');
		// A preview tab link for a task whose preview has gone falls back to Stages.
		expect(pickTab('preview', tabs)).toBe('stages');
	});
});

describe('stages', () => {
	it('expands only the current stage', () => {
		expect(openByDefault(step({ state: 'current' }))).toBe(true);
		for (const state of ['done', 'upcoming', 'skipped'] as const) {
			expect(openByDefault(step({ state }))).toBe(false);
		}
	});

	it('has detail to expand for reached stages and noted ones', () => {
		expect(hasDetail(step({ state: 'done' }))).toBe(true);
		expect(hasDetail(step({ state: 'upcoming' }))).toBe(false);
		expect(hasDetail(step({ state: 'skipped', note: 'No PR for a prototype' }))).toBe(true);
	});

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

describe('preview feedback thread', () => {
	const msg = (o: Partial<BridgeMessage>): BridgeMessage => ({
		requestId: 'r1',
		text: feedbackNote('http://127.0.0.1:4399/', 'Make the header calmer'),
		taskId: 'wh-1',
		submittedAt: '2026-10-25T10:00:00Z',
		delivery: 'delivered',
		deliveryDetail: null,
		acknowledged: null,
		noteId: null,
		reply: null,
		...o
	});

	it('keeps only this task’s preview feedback, without the note’s preamble', () => {
		const thread = previewThread(
			[
				msg({}),
				msg({ requestId: 'r2', text: 'An ordinary question about wh-1' }),
				msg({ requestId: 'r3', taskId: 'wh-2' }),
				msg({ requestId: 'r4', acknowledged: true, reply: { body: 'On it', at: null } })
			],
			'wh-1'
		);
		expect(thread.map((c) => c.id)).toEqual(['r1', 'r4']);
		expect(thread[0]).toMatchObject({
			text: 'Make the header calmer',
			status: 'Sent to Firstmate',
			failed: false,
			reply: null
		});
		expect(thread[1]).toMatchObject({ status: 'Firstmate has it', reply: 'On it' });
	});

	it('says plainly when feedback did not get through', () => {
		const [c] = previewThread([msg({ delivery: 'failed' })], 'wh-1');
		expect(c).toMatchObject({ status: 'Not delivered', failed: true });
	});
});
