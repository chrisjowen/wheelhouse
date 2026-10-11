import { describe, expect, it } from 'vitest';
import { chartColumns, harbour, headline, LANDED_RECENT_MS } from './harbour';
import type { PassageStep, TaskStatus, TaskSummary } from './types';

const step = (key: string, column = key): PassageStep => ({
	key,
	label: key,
	short: key,
	state: 'upcoming',
	note: null,
	column,
	evidence: []
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
		passage: { track: 'ship', steps: [step('queued'), step('building')], current: 0, basis: '' },
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

describe('chartColumns', () => {
	it('derives columns from the steps, aligning scout steps with ship steps', () => {
		const ship = task('s', 'working', {
			passage: {
				track: 'ship',
				steps: ['queued', 'building', 'checks', 'pr'].map((k) => step(k)),
				current: 0,
				basis: ''
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
				basis: ''
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
				basis: ''
			}
		});
		expect(chartColumns([t]).map((c) => c.key)).toEqual(['queued', 'released', 'landed']);
	});
});
