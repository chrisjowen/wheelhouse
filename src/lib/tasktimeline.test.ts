import { describe, expect, it } from 'vitest';
import { strandOf, taskTimeline, timelineItems, type TimelineInput } from './tasktimeline';
import type { TalkEntry } from './buildlog';
import type { PassageStep, TaskRun } from './types';

const step = (key: string, state: PassageStep['state'], column = key): PassageStep => ({
	key,
	label: key,
	short: key,
	state,
	note: null,
	column,
	evidence: [],
	failed: false
});
const at = (m: number) => new Date(Date.UTC(2026, 10, 10, 12, m)).toISOString();
const talk = (m: number, kind: TalkEntry['kind'] = 'steer'): TalkEntry => ({
	id: `t${m}`,
	at: at(m),
	kind,
	from: 'firstmate',
	to: 'worker',
	title: `said at ${m}`,
	body: null,
	questions: [],
	reply: null,
	outcome: { state: 'read', label: 'Read' }
});
const input = (o: Partial<TimelineInput> = {}): TimelineInput => ({
	steps: [],
	history: [],
	talk: [],
	shots: [],
	validations: [],
	runs: [],
	preview: null,
	...o
});

describe('timelineItems', () => {
	it('merges the history, conversation, screenshots and runs, oldest first', () => {
		const items = timelineItems(
			input({
				history: [
					{ at: at(5), kind: 'status', state: 'working', text: 'setup done' },
					{ at: at(0), kind: 'dispatched', state: null, text: 'Dispatched' },
					{ at: at(40), kind: 'merged', state: null, text: 'https://github.com/o/r/pull/12' }
				],
				talk: [talk(10)],
				shots: [
					{ name: 'b.png', url: '/b', modifiedAt: at(21) },
					{ name: 'a.png', url: '/a', modifiedAt: at(20) },
					{ name: 'c.png', url: '/c', modifiedAt: at(50) }
				],
				validations: [
					{ id: 'r1', startedAt: at(25), outcome: 'failed', text: 'Failed at tests' },
					{ id: 'r2', startedAt: at(30), outcome: 'passed', text: 'All checks passed' }
				]
			})
		);
		expect(items.map((i) => i.kind)).toEqual([
			'event',
			'status',
			'talk',
			'shots',
			'validation',
			'validation',
			'event',
			'shots'
		]);
		const shots = items.filter((i) => i.kind === 'shots');
		expect(shots.map((s) => s.kind === 'shots' && s.shots.map((x) => x.name))).toEqual([
			['a.png', 'b.png'],
			['c.png']
		]);
		const v = items.filter((i) => i.kind === 'validation');
		expect(v.map((x) => x.kind === 'validation' && x.latest)).toEqual([false, true]);
		expect(items.at(-2)).toMatchObject({
			event: 'merged',
			pr: 12,
			url: 'https://github.com/o/r/pull/12',
			text: 'Merged pull request #12'
		});
	});

	it('leaves the worker’s questions to the conversation, unless it could not be read', () => {
		const history = [
			{ at: at(1), kind: 'status' as const, state: 'needs-decision', text: 'which table?' },
			{ at: at(2), kind: 'status' as const, state: 'resolved', text: 'answered: prefs' },
			{ at: at(3), kind: 'status' as const, state: 'working', text: 'on it' }
		];
		expect(timelineItems(input({ history })).map((i) => i.kind)).toEqual(['status']);
		expect(timelineItems(input({ history, talk: null }))).toHaveLength(3);
	});

	it('shows a reported preview as a preview, and adds the last one when no line names it', () => {
		const items = timelineItems(
			input({
				history: [
					{ at: at(1), kind: 'status', state: 'note', text: 'preview http://127.0.0.1:5173/x.' }
				],
				preview: { url: 'http://127.0.0.1:5173/x', at: at(1) }
			})
		);
		expect(items).toEqual([{ kind: 'preview', at: at(1), url: 'http://127.0.0.1:5173/x' }]);
		const added = timelineItems(input({ preview: { url: 'http://127.0.0.1:9/', at: null } }));
		expect(added).toEqual([{ kind: 'preview', at: null, url: 'http://127.0.0.1:9/' }]);
	});

	it('marks later runs, with the changes that started them', () => {
		const run = (n: number, m: number) => ({ n, startedAt: at(m) }) as TaskRun;
		const items = timelineItems(input({ runs: [run(1, 0), run(2, 30)] }));
		expect(items).toHaveLength(1);
		expect(items[0]).toMatchObject({ kind: 'run', at: at(30) });
	});
});

describe('taskTimeline', () => {
	const ship = (current: number) =>
		['queued', 'building', 'checks', 'pr', 'review', 'landed'].map((k, i) =>
			step(k, i < current ? 'done' : i === current ? 'current' : 'upcoming')
		);

	it('groups each entry under the stage reached by its time', () => {
		const t = taskTimeline(
			input({
				steps: ship(5),
				history: [
					{ at: at(0), kind: 'dispatched', state: null, text: 'Dispatched' },
					{ at: at(5), kind: 'status', state: 'working', text: 'building' },
					{
						at: at(31),
						kind: 'status',
						state: 'done',
						text: 'PR https://github.com/o/r/pull/7 checks green'
					},
					{ at: at(32), kind: 'pr-ready', state: null, text: 'https://github.com/o/r/pull/7' },
					{ at: at(60), kind: 'merged', state: null, text: 'https://github.com/o/r/pull/7' }
				],
				talk: [talk(26), talk(45)],
				validations: [{ id: 'r', startedAt: at(20), outcome: 'passed', text: 'passed' }]
			})
		);
		const by = Object.fromEntries(t.sections.map((s) => [s.step.key, s.items.map((i) => i.at)]));
		expect(by).toEqual({
			queued: [],
			building: [at(0), at(5)],
			checks: [at(20), at(26)],
			// The worker's report names the PR; the ledger's ready record starts Your review.
			pr: [at(31)],
			review: [at(32), at(45)],
			landed: [at(60)]
		});
		expect(t.sections.find((s) => s.step.key === 'checks')?.at).toBe(at(20));
		expect(t.upcoming).toEqual([]);
	});

	it('lists stages not reached yet, and puts undated entries under the latest stage', () => {
		const t = taskTimeline(
			input({
				steps: ship(2),
				history: [{ at: at(0), kind: 'dispatched', state: null, text: 'Dispatched' }],
				preview: { url: 'http://127.0.0.1:1/', at: null }
			})
		);
		expect(t.sections.map((s) => s.step.key)).toEqual(['queued', 'building', 'checks']);
		expect(t.upcoming.map((s) => s.key)).toEqual(['pr', 'review', 'landed']);
		// No validation run dated yet: the launch stays under Building, Checks holds the undated preview.
		expect(t.sections[1].items.map((i) => i.kind)).toEqual(['event']);
		expect(t.sections[2].items.map((i) => i.kind)).toEqual(['preview']);
	});

	it('leaves dated entries with the dated stage before an undated one', () => {
		const t = taskTimeline(
			input({
				steps: ['building', 'checks', 'pr', 'review', 'landed'].map((k) => step(k, 'done')),
				history: [
					{ at: at(0), kind: 'status', state: 'working', text: 'started' },
					{ at: at(5), kind: 'status', state: 'working', text: 'tests green' },
					{ at: at(10), kind: 'status', state: 'working', text: 'opened https://h/o/r/pull/3' },
					{ at: at(12), kind: 'status', state: 'done', text: 'ready https://h/o/r/pull/3' },
					{ at: at(30), kind: 'status', state: 'working', text: 'addressed review' }
				],
				talk: [talk(7)]
			})
		);
		const by = Object.fromEntries(t.sections.map((s) => [s.step.key, s.items.map((i) => i.at)]));
		expect(by).toEqual({
			building: [at(0), at(5), at(7)],
			checks: [],
			pr: [at(10)],
			review: [at(12), at(30)],
			landed: []
		});
	});

	it('keeps a skipped stage, with nothing under it', () => {
		const steps = [step('building', 'done'), step('checks', 'skipped'), step('pr', 'current')];
		const t = taskTimeline(
			input({
				steps,
				history: [
					{ at: at(1), kind: 'status', state: 'working', text: 'x' },
					{ at: at(9), kind: 'status', state: 'working', text: 'see https://h/o/r/pull/3' }
				]
			})
		);
		expect(t.sections.map((s) => [s.step.key, s.items.length])).toEqual([
			['building', 1],
			['checks', 0],
			['pr', 1]
		]);
	});

	it('never starts a stage before the one before it', () => {
		const t = taskTimeline(
			input({
				steps: ship(3),
				history: [
					{ at: at(10), kind: 'dispatched', state: null, text: 'Dispatched' },
					// A PR named before the checks ran (a direct PR, say).
					{ at: at(12), kind: 'status', state: 'working', text: 'https://h/o/r/pull/3' }
				],
				validations: [{ id: 'r', startedAt: at(20), outcome: 'running', text: 'running' }]
			})
		);
		expect(t.sections.find((s) => s.step.key === 'pr')?.at).toBe(at(20));
	});
});

describe('strandOf', () => {
	it('sorts entries into the conversation, the worker’s updates, and checks and PRs', () => {
		expect(strandOf({ kind: 'talk', at: at(0), entry: talk(0) })).toBe('talk');
		expect(strandOf({ kind: 'status', at: at(0), state: 'working', text: '' })).toBe('updates');
		expect(
			strandOf({ kind: 'event', at: at(0), event: 'merged', pr: 1, url: null, text: '' })
		).toBe('checks');
		expect(
			strandOf({ kind: 'event', at: at(0), event: 'launched', pr: null, url: null, text: '' })
		).toBe('updates');
	});
});
