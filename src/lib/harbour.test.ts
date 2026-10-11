import { describe, expect, it } from 'vitest';
import { chartColumns, harbour, headline, LANDED_RECENT_MS, shelf, shelfOf } from './harbour';
import type { PassageStep, TaskStatus, TaskSummary } from './types';

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
		...o
	};
}

const NOW = Date.parse('2026-10-11T12:00:00Z');

describe('harbour', () => {
	it('splits the fleet into Needs you, Waiting on Firstmate, under way, queued and landed', () => {
		const h = harbour(
			[
				task('rev', 'needs-review', {
					attention: { kind: 'review', owner: 'captain', text: '', url: null }
				}),
				task('fm', 'with-firstmate', {
					attention: { kind: 'decision', owner: 'firstmate', text: '', url: null }
				}),
				task('w', 'working'),
				task('b', 'blocked'),
				task('q', 'queued'),
				task('new', 'landed', { mergedAt: new Date(NOW - 3600_000).toISOString() }),
				task('old', 'landed', { mergedAt: new Date(NOW - LANDED_RECENT_MS - 1).toISOString() })
			],
			NOW
		);
		expect(h.needsYou.map((t) => t.id)).toEqual(['rev']);
		expect(h.waitingOnFirstmate.map((t) => t.id)).toEqual(['fm']);
		expect(h.underWay.map((t) => t.id)).toEqual(['b', 'w']);
		expect(h.trouble.map((t) => t.id)).toEqual(['b']);
		expect(h.queued.map((t) => t.id)).toEqual(['q']);
		expect(h.landedRecent.map((t) => t.id)).toEqual(['new']);
		expect(h.landedOlder.map((t) => t.id)).toEqual(['old']);
		expect(headline(h)).toBe(
			'1 thing needs you. 1 landed in the last day. 2 under way, 1 waiting on Firstmate, 1 with Firstmate keeping an eye on them.'
		);
	});

	it('says plainly when nothing needs the captain', () => {
		expect(headline(harbour([], NOW))).toBe(
			'Nothing needs you. 0 landed in the last day. 0 under way.'
		);
	});
});

describe('the watch report with declared passages', () => {
	const recent = new Date(NOW - 3600_000).toISOString();
	const deployedStep = (current: boolean, failed = false): PassageStep => ({
		...step('deployed'),
		label: 'Deployed',
		state: current ? 'current' : 'upcoming',
		failed
	});
	const shipped = (
		id: string,
		live: boolean | null,
		o: { current?: boolean; failed?: boolean } = {}
	) =>
		task(id, 'landed', {
			mergedAt: recent,
			passage: {
				track: 'ship',
				steps: [step('landed'), deployedStep(!!o.current, o.failed)],
				current: o.current ? 1 : 0,
				basis: '',
				...NO_DECLARED,
				live
			}
		});

	it('counts live tasks only where a passage declares a live step', () => {
		expect(headline(harbour([task('a', 'landed', { mergedAt: recent })], NOW))).toBe(
			'Nothing needs you. 1 landed in the last day. 0 under way.'
		);
		const h = harbour([shipped('a', true, { current: true }), shipped('b', false)], NOW);
		expect(h.live?.map((t) => t.id)).toEqual(['a']);
		expect(headline(h)).toBe('Nothing needs you. 2 landed in the last day, 1 live. 0 under way.');
	});

	it('says when a step failed, without making it a "needs you" item', () => {
		const h = harbour([shipped('a', false, { current: true, failed: true })], NOW);
		expect(h.needsYou).toEqual([]);
		expect(h.stepFailed.map((t) => t.id)).toEqual(['a']);
		expect(headline(h)).toBe(
			'Nothing needs you. 1 landed in the last day, 0 live, 1 failed at Deployed. 0 under way.'
		);
	});
});

describe('chartColumns', () => {
	it('derives columns from the steps, aligning scout steps with ship steps', () => {
		const ship = task('s', 'working', {
			passage: {
				track: 'ship',
				steps: ['queued', 'building', 'checks', 'pr'].map((k) => step(k)),
				current: 0,
				basis: '',
				...NO_DECLARED
			}
		});
		const scout = task('c', 'working', {
			passage: {
				track: 'scout',
				steps: [
					step('queued'),
					{ ...step('investigating', 'building'), label: 'Scout' },
					step('report', 'pr')
				],
				current: 0,
				basis: '',
				...NO_DECLARED
			}
		});
		expect(chartColumns([scout, ship])).toEqual([
			{ key: 'queued', label: 'queued' },
			{ key: 'building', label: 'building' },
			{ key: 'checks', label: 'checks' },
			{ key: 'pr', label: 'pr' }
		]);
		expect(chartColumns([scout]).map((c) => c.label)).toEqual(['queued', 'Scout', 'report']);
	});

	it('lines up a new step key without code changes', () => {
		const t = task('x', 'working', {
			passage: {
				track: 'ship',
				steps: [step('queued'), step('released'), step('landed')],
				current: 1,
				basis: '',
				...NO_DECLARED
			}
		});
		expect(chartColumns([t]).map((c) => c.key)).toEqual(['queued', 'released', 'landed']);
	});
});

describe('shelf (Under way | Completed)', () => {
	const tasks = [
		task('rev', 'needs-review', {
			attention: { kind: 'review', owner: 'captain', text: '', url: null }
		}),
		task('w', 'working'),
		task('q', 'queued'),
		task('old', 'landed', { completedOn: '2026-10-01' }),
		task('new', 'landed', { mergedAt: '2026-10-11T11:00:00Z' }),
		task('scout', 'done', {
			current: {
				state: 'done',
				source: null,
				detail: null,
				observedAt: '2026-10-05T00:00:00Z',
				fresh: true
			}
		})
	];

	it('reads the toggle from ?view=, defaulting to under way', () => {
		expect(shelfOf(null)).toBe('under-way');
		expect(shelfOf('passage')).toBe('under-way');
		expect(shelfOf('completed')).toBe('completed');
	});

	it('keeps what needs the captain under way', () => {
		expect(shelf(tasks, 'under-way').map((t) => t.id)).toEqual(['rev', 'w', 'q']);
	});

	it('lists landed and finished work newest first', () => {
		expect(shelf(tasks, 'completed').map((t) => t.id)).toEqual(['new', 'scout', 'old']);
	});
});
