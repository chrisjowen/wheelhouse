import { describe, expect, it } from 'vitest';
import { LANDED_RECENT_MS } from './harbour';
import {
	LANDED_BRIGHT_MS,
	LANDED_FAINTEST,
	laneOf,
	landedFade,
	laneSince,
	radar,
	signalOf,
	stay,
	track
} from './radar';
import type { PassageStep, TaskStatus, TaskSummary } from './types';

const step = (key: string, column = key, failed = false): PassageStep => ({
	key,
	label: key,
	short: key,
	state: 'upcoming',
	note: null,
	column,
	evidence: [],
	failed
});

const SHIP = ['queued', 'building', 'checks', 'pr', 'review', 'landed'].map((k) => step(k));
const SCOUT = [
	step('queued'),
	step('investigating', 'building'),
	step('report', 'pr'),
	step('decision', 'review'),
	step('done', 'landed')
];

/** A synthetic task at one step of the built-in ship passage. */
function task(
	id: string,
	status: TaskStatus,
	at: string,
	o: Partial<TaskSummary> = {}
): TaskSummary {
	const steps = o.passage?.steps ?? SHIP;
	return {
		id,
		title: `demo: ${id}`,
		shortTitle: id,
		projectId: 'demo',
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
		shots: [],
		...o,
		passage: {
			track: 'ship',
			basis: '',
			custom: false,
			live: null,
			link: null,
			checks: [],
			...o.passage,
			steps,
			current: Math.max(
				0,
				steps.findIndex((s) => s.key === at)
			)
		}
	};
}

const NOW = Date.parse('2026-10-27T12:00:00Z');
const iso = (ago: number) => new Date(NOW - ago).toISOString();
const CAPTAIN = { kind: 'review', owner: 'captain', text: '', url: null } as const;

describe('laneOf', () => {
	it('puts each built-in ship step in its lane', () => {
		expect(laneOf(task('q', 'queued', 'queued'))).toBe('queued');
		expect(laneOf(task('b', 'working', 'building'))).toBe('building');
		expect(laneOf(task('c', 'working', 'checks'))).toBe('testing');
		expect(laneOf(task('p', 'working', 'pr'))).toBe('pr');
		expect(laneOf(task('r', 'needs-review', 'review'))).toBe('pr');
		expect(laneOf(task('l', 'landed', 'landed'))).toBe('landed');
	});

	it('lines scout steps up by their columns', () => {
		const scout = (at: string) => task('s', 'working', at, { passage: { steps: SCOUT } as never });
		expect(laneOf(scout('investigating'))).toBe('building');
		expect(laneOf(scout('report'))).toBe('pr');
		expect(laneOf(scout('decision'))).toBe('pr');
		expect(laneOf(scout('done'))).toBe('landed');
	});

	it('puts a step a passage file added in the lane of the built-in step before it', () => {
		const steps = [...SHIP, step('deployed')];
		const t = task('d', 'working', 'deployed', { passage: { steps } as never });
		expect(laneOf(t)).toBe('landed');
		const staging = [step('queued'), step('building'), step('staging'), step('pr')];
		expect(laneOf(task('s', 'working', 'staging', { passage: { steps: staging } as never }))).toBe(
			'building'
		);
	});

	it('trusts the status for queued and landed work', () => {
		expect(laneOf(task('q', 'queued', 'building'))).toBe('queued');
		expect(laneOf(task('l', 'landed', 'review'))).toBe('landed');
	});
});

describe('signalOf', () => {
	it('is amber when the captain is needed, before anything else', () => {
		expect(signalOf(task('a', 'needs-review', 'review', { attention: CAPTAIN }))).toBe('you');
		expect(
			signalOf(
				task('d', 'needs-decision', 'building', {
					attention: { ...CAPTAIN, kind: 'decision' },
					busy: true
				})
			)
		).toBe('you');
	});

	it('is red when work is stuck: blocked, failed, lost, a failed step or a failed run', () => {
		for (const s of ['blocked', 'failed', 'lost', 'unknown'] as const)
			expect(signalOf(task(s, s, 'building'))).toBe('stuck');
		const failedStep = task('f', 'working', 'deployed', {
			passage: { steps: [...SHIP, step('deployed', 'deployed', true)] } as never,
			busy: true
		});
		expect(signalOf(failedStep)).toBe('stuck');
		const run = task('r', 'working', 'checks', {
			pipeline: { outcome: 'failed' } as TaskSummary['pipeline']
		});
		expect(signalOf(run)).toBe('stuck');
	});

	it('pulses only while the worker is busy, and says when Firstmate has it', () => {
		expect(signalOf(task('w', 'working', 'building', { busy: true }))).toBe('busy');
		expect(signalOf(task('w', 'working', 'building'))).toBe('idle');
		expect(signalOf(task('p', 'waiting', 'pr'))).toBe('idle');
		expect(signalOf(task('f', 'with-firstmate', 'building', { busy: true }))).toBe('firstmate');
		expect(signalOf(task('l', 'landed', 'landed'))).toBe('landed');
	});
});

describe('laneSince', () => {
	it('reads the time in the lane from the most specific record', () => {
		const run = task('c', 'working', 'checks', {
			pipeline: { startedAt: iso(5 * 60_000) } as TaskSummary['pipeline'],
			activity: { text: '', at: iso(60_000), source: 'status' },
			since: '2026-10-26'
		});
		expect(laneSince(run)).toBe(NOW - 5 * 60_000);
		expect(laneSince(task('l', 'landed', 'landed', { mergedAt: iso(30_000) }))).toBe(NOW - 30_000);
	});

	it('never takes the filing date or the latest status line for when the task reached its lane', () => {
		const t = task('b', 'working', 'building', {
			activity: { text: '', at: iso(60_000), source: 'status' },
			since: '2026-10-24'
		});
		expect(laneSince(t)).toBeNull();
		expect(laneSince(task('q', 'queued', 'queued', { since: '2026-10-26' }))).toBeNull();
		const pr = task('p', 'working', 'pr', {
			activity: { text: '', at: iso(60_000), source: 'status' },
			since: '2026-10-24'
		});
		expect(laneSince(pr)).toBeNull();
		expect(laneSince(task('x', 'working', 'building'))).toBeNull();
	});
});

describe('track', () => {
	const long = task('long', 'working', 'checks', {
		busy: true,
		since: '2026-10-24',
		pipeline: { startedAt: iso(3 * 3600_000) } as TaskSummary['pipeline'],
		activity: { text: '', at: iso(60_000), source: 'status' }
	});

	it('takes a task it has not seen from the records, not from now', () => {
		const e = track(new Map(), [long], NOW).get('long')!;
		expect(e).toEqual({
			lane: 'testing',
			step: 'checks',
			laneSince: NOW - 3 * 3600_000,
			stepSince: null
		});
		const building = task('b', 'working', 'building', { since: '2026-10-24' });
		expect(track(new Map(), [building], NOW).get('b')!.laneSince).toBeNull();
	});

	it('times a lane change from when it was seen, and a step change within a lane as the step only', () => {
		const first = track(new Map(), [task('p', 'working', 'pr')], NOW);
		const moved = track(first, [task('p', 'needs-review', 'review')], NOW + 1000).get('p')!;
		expect(moved).toMatchObject({
			lane: 'pr',
			step: 'review',
			laneSince: null,
			stepSince: NOW + 1000
		});

		const c = track(first, [task('p', 'working', 'checks')], NOW + 2000).get('p')!;
		expect(c).toMatchObject({ lane: 'testing', laneSince: NOW + 2000, stepSince: NOW + 2000 });

		const same = track(first, [task('p', 'working', 'pr', { busy: true })], NOW + 3000);
		expect(same.get('p')).toBe(first.get('p'));
	});

	it('records no move for tasks a change of project brings into view', () => {
		const a = track(new Map(), [long], NOW);
		const other = task('other', 'working', 'pr');
		const all = track(a, [long, other], NOW + 5000);
		expect(all.get('other')).toMatchObject({ laneSince: null, stepSince: null });
		expect(all.get('long')).toBe(a.get('long'));
	});

	it('keeps a long-running task with a fresh status line longest in its lane', () => {
		const quick = task('quick', 'working', 'checks', {
			busy: true,
			pipeline: { startedAt: iso(5 * 60_000) } as TaskSummary['pipeline']
		});
		const tasks = [quick, long];
		const r = radar(tasks, NOW, track(new Map(), tasks, NOW));
		const testing = r.lanes.find((l) => l.key === 'testing')!.blips;
		expect(testing.map((b) => b.id)).toEqual(['long', 'quick']);
		expect(stay(testing[0].since, NOW)).toBe('3 h');
	});
});

describe('landedFade', () => {
	it('stays bright for an hour, then fades until the dot leaves after a day', () => {
		expect(landedFade(NOW - 60_000, NOW)).toBe(1);
		expect(landedFade(NOW - LANDED_BRIGHT_MS, NOW)).toBe(1);
		const mid = landedFade(NOW - (LANDED_BRIGHT_MS + LANDED_RECENT_MS) / 2, NOW);
		expect(mid).toBeLessThan(1);
		expect(mid).toBeGreaterThan(LANDED_FAINTEST);
		expect(landedFade(NOW - LANDED_RECENT_MS, NOW)).toBeCloseTo(LANDED_FAINTEST);
		expect(landedFade(null, NOW)).toBe(LANDED_FAINTEST);
	});
});

describe('radar', () => {
	const fleet = [
		task('queued-1', 'queued', 'queued', { since: '2026-10-27' }),
		task('slow', 'working', 'building', { busy: true }),
		task('quick', 'working', 'building', { busy: true }),
		task('stuck', 'blocked', 'building'),
		task('ask', 'needs-review', 'review', { attention: CAPTAIN }),
		task('new', 'landed', 'landed', { mergedAt: iso(10 * 60_000) }),
		task('older', 'landed', 'landed', { mergedAt: iso(5 * 3600_000) }),
		task('gone', 'landed', 'landed', { mergedAt: iso(LANDED_RECENT_MS + 60_000) })
	];
	const queued = (id: string) => task(id, 'queued', 'queued');
	const building = (id: string) => task(id, 'working', 'building', { busy: true });
	let seen = track(new Map(), [queued('slow'), queued('quick')], NOW - 3600_000);
	seen = track(seen, [building('slow'), queued('quick')], NOW - 40 * 60_000);
	seen = track(seen, [building('slow'), building('quick')], NOW - 2 * 60_000);
	const r = radar(fleet, NOW, track(seen, fleet, NOW));
	const ids = (lane: string) => r.lanes.find((l) => l.key === lane)!.blips.map((b) => b.id);

	it('draws five lanes, Queued to Landed', () => {
		expect(r.lanes.map((l) => l.label)).toEqual([
			'Queued',
			'Building',
			'Testing',
			'Pull request',
			'Landed'
		]);
		expect(ids('queued')).toEqual(['queued-1']);
		expect(ids('testing')).toEqual([]);
		expect(ids('pr')).toEqual(['ask']);
	});

	it('orders a lane most pressing first, then longest in the lane', () => {
		expect(ids('building')).toEqual(['stuck', 'slow', 'quick']);
	});

	it('keeps landed dots for a day, newest first and fading, and counts the rest', () => {
		expect(ids('landed')).toEqual(['new', 'older']);
		const [fresh, faded] = r.lanes.find((l) => l.key === 'landed')!.blips;
		expect(fresh.opacity).toBe(1);
		expect(faded.opacity).toBeLessThan(1);
		expect(r.landedOlder).toBe(1);
		expect(r.counts).toMatchObject({ busy: 2, stuck: 1, you: 1, landed: 2, idle: 1 });
	});
});

describe('stay', () => {
	it('says the time in a lane in a few words', () => {
		expect(stay(null, NOW)).toBe('unknown');
		expect(stay(NOW - 20_000, NOW)).toBe('under a minute');
		expect(stay(NOW - 12 * 60_000, NOW)).toBe('12 min');
		expect(stay(NOW - 5 * 3600_000, NOW)).toBe('5 h');
		expect(stay(NOW - 4 * 86400_000, NOW)).toBe('4 days');
	});
});
