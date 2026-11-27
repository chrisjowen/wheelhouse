import { describe, expect, it } from 'vitest';
import { optionsFor, type InboxCard } from '$lib/inbox';
import type { TaskDetail } from '$lib/types';
import { taskSummary } from '../../tests/helpers/task-summary';
import {
	SEEN_KEEP_MS,
	calmOf,
	clearedCalls,
	focusOn,
	inArrivalOrder,
	inFront,
	isSeen,
	mergeFacts,
	nextAfter,
	parseSeen,
	reviewPoints,
	seenKey,
	waitingCalls
} from './calls';

const NOW = Date.parse('2026-10-27T10:00:00Z');
const minsAgo = (m: number) => new Date(NOW - m * 60_000).toISOString();

const card = (id: string, o: Partial<InboxCard> = {}): InboxCard => ({
	id,
	taskId: id.split(':')[0],
	taskTitle: 'x',
	projectId: 'lumen',
	kind: 'hold',
	key: 'captain-hold',
	question: `${id}?`,
	title: `${id}?`,
	origin: null,
	following: null,
	askedAt: minsAgo(20),
	owner: 'captain',
	evidence: {
		text: null,
		report: null,
		findings: [],
		file: null,
		pr: null,
		preview: null,
		previewTask: null,
		board: null,
		checks: null,
		screenshots: [],
		docs: []
	},
	options: optionsFor('hold'),
	recommendation: null,
	choices: null,
	sent: null,
	...o
});

const sent = (at = minsAgo(1)): InboxCard['sent'] => ({
	choice: 'approve',
	picks: null,
	note: null,
	at,
	delivery: 'delivered',
	detail: null,
	requestId: 'r'
});

describe('waiting calls', () => {
	it('keeps what waits on the captain, oldest first, so a new call joins the end', () => {
		const cards = [
			card('b:1', { askedAt: minsAgo(5) }),
			card('a:1', { askedAt: minsAgo(30) }),
			card('c:1', { askedAt: null }),
			card('d:1', { owner: 'firstmate' }),
			card('e:1', { following: minsAgo(2) }),
			card('f:1', { sent: sent() })
		];
		expect(waitingCalls(cards, {}, NOW).map((c) => c.id)).toEqual(['a:1', 'b:1', 'c:1']);
	});

	it('leaves out a call put off for later in this browser', () => {
		const cards = [card('a:1'), card('b:1')];
		expect(waitingCalls(cards, { 'a:1': NOW + 60_000 }, NOW).map((c) => c.id)).toEqual(['b:1']);
	});

	it('orders calls asked at the same moment by id, steadily', () => {
		const at = minsAgo(3);
		expect(
			inArrivalOrder([card('b:1', { askedAt: at }), card('a:1', { askedAt: at })]).map((c) => c.id)
		).toEqual(['a:1', 'b:1']);
	});
});

describe('seen', () => {
	it('keys a call by its question asked, so the same card asked again is new', () => {
		const a = card('a:1', { askedAt: minsAgo(10) });
		const seen = { [seenKey(a)]: NOW };
		expect(isSeen(seen, a)).toBe(true);
		expect(isSeen(seen, { ...a, askedAt: minsAgo(1) })).toBe(false);
	});

	it('reads what this browser kept, forgetting old marks and anything malformed', () => {
		const raw = JSON.stringify({ old: NOW - SEEN_KEEP_MS - 1, fresh: NOW - 1000, bad: 'x' });
		expect(parseSeen(raw, NOW)).toEqual({ fresh: NOW - 1000 });
		expect(parseSeen('not json', NOW)).toEqual({});
		expect(parseSeen('[1]', NOW)).toEqual({});
		expect(parseSeen(null, NOW)).toEqual({});
	});
});

describe('never stealing the card being read', () => {
	const a = card('a:1', { askedAt: minsAgo(30) });
	const b = card('b:1', { askedAt: minsAgo(20) });
	const c = card('c:1', { askedAt: minsAgo(1) });

	it('keeps the card in front while it still waits, whatever arrives', () => {
		expect(inFront([a, b, c], 'b:1', {})).toBe('b:1');
	});

	it('brings the first not seen yet forward when nothing is in front', () => {
		const seen = { [seenKey(a)]: NOW };
		expect(inFront([a, b, c], null, seen)).toBe('b:1');
		expect(inFront([a, b, c], 'gone', seen)).toBe('b:1');
		expect(inFront([a], null, seen)).toBe('a:1');
		expect(inFront([], null, seen)).toBeNull();
	});

	it('after an answer, comes to the first call not seen yet, else the next in line', () => {
		expect(nextAfter([a, b, c], 'a:1', { [seenKey(b)]: NOW })).toBe('c:1');
		const all = { [seenKey(a)]: NOW, [seenKey(b)]: NOW, [seenKey(c)]: NOW };
		expect(nextAfter([a, b, c], 'b:1', all)).toBe('c:1');
		expect(nextAfter([a, b, c], 'c:1', all)).toBe('b:1');
		expect(nextAfter([a], 'a:1', all)).toBeNull();
	});
});

describe('calls that clear themselves', () => {
	const a = card('a:1');
	const b = card('b:1');
	const c = card('c:1');
	const seen = { [seenKey(a)]: NOW, [seenKey(c)]: NOW };

	it('keeps a seen call that left without the captain’s answer, and counts an unseen one', () => {
		const out = clearedCalls([a, b, c], [], seen, () => false, new Set());
		expect(out.seen.map((x) => x.id)).toEqual(['a:1', 'c:1']);
		expect(out.unseen.map((x) => x.id)).toEqual(['b:1']);
	});

	it('is not fooled by an answer given here, logged, or on its way', () => {
		const out = clearedCalls(
			[a, b, { ...c, sent: sent() }],
			[],
			seen,
			(id) => id === 'a:1',
			new Set(['b:1'])
		);
		expect(out).toEqual({ seen: [], unseen: [] });
	});

	it('ignores calls still in the inbox', () => {
		expect(clearedCalls([a, b], [a, b], seen, () => false, new Set())).toEqual({
			seen: [],
			unseen: []
		});
	});
});

describe('focus mode', () => {
	it('is as this browser left it, else on for a phone', () => {
		expect(focusOn('1', false)).toBe(true);
		expect(focusOn('0', true)).toBe(false);
		expect(focusOn(null, true)).toBe(true);
		expect(focusOn(null, false)).toBe(false);
	});
});

describe('the calm line', () => {
	it('counts what is under way and landed today, with the latest thing that moved', () => {
		const tasks = [
			taskSummary('one', 'working', {
				activity: { text: 'Writing tests', at: minsAgo(10), source: 'status' }
			}),
			taskSummary('two', 'working', {
				activity: { text: 'Checks: 3 of 5', at: minsAgo(2), source: 'pipeline' }
			}),
			taskSummary('three', 'working'),
			taskSummary('done', 'landed', { mergedAt: minsAgo(30) }),
			taskSummary('older', 'landed', { mergedAt: new Date(NOW - 20 * 3600_000).toISOString() })
		];
		const calm = calmOf(tasks, NOW);
		expect(calm.underWay).toBe(3);
		expect(calm.landedToday).toBe(1);
		expect(calm.latest).toMatchObject({ taskId: 'two', text: 'Checks: 3 of 5' });
		expect(calm.log.map((e) => e.taskId)).toEqual(['older', 'done', 'one', 'two']);
	});

	it('keeps the log short', () => {
		const tasks = Array.from({ length: 12 }, (_, i) =>
			taskSummary(`t${i}`, 'working', {
				activity: { text: `step ${i}`, at: minsAgo(20 - i), source: 'status' }
			})
		);
		expect(calmOf(tasks, NOW, 8).log).toHaveLength(8);
	});
});

describe('the merge evidence', () => {
	const detail = (o: Partial<TaskDetail['evidence']> = {}, intent: string | null = null) =>
		({
			brief: intent
				? {
						available: true,
						value: {
							path: 'x',
							intent,
							spec: null,
							rest: '',
							bytes: 1,
							truncated: false,
							mate: null,
							remote: false
						},
						source: 'x',
						observedAt: null
					}
				: { available: false, reason: 'none' },
			evidence: {
				files: {
					available: true,
					value: {
						base: 'main',
						mergeBase: 'abc',
						branch: 'fm/x',
						files: [
							{ path: 'a.ts', status: 'M', additions: 10, deletions: 2 },
							{ path: 'b.ts', status: 'M', additions: 100, deletions: 0 },
							{ path: 'c.png', status: 'A', additions: null, deletions: null }
						],
						total: 3,
						truncated: false
					},
					source: 'git',
					observedAt: null
				},
				pr: {
					available: true,
					value: {
						url: 'u',
						number: 7,
						state: 'OPEN',
						draft: false,
						reviewDecision: null,
						checks: [
							{ name: 'a', state: 'pass' },
							{ name: 'b', state: 'pass' },
							{ name: 'c', state: 'skipped' }
						]
					},
					source: 'gh',
					observedAt: null
				},
				report: { available: false, reason: 'none' },
				screenshots: { available: false, reason: 'none' },
				preview: { available: false, reason: 'none' },
				decisions: [],
				validation: { available: false, reason: 'none' },
				...o
			}
		}) as Pick<TaskDetail, 'evidence' | 'brief'>;
	const shots = (names: string[]) => ({
		available: true as const,
		value: names.map((name, i) => ({
			name,
			url: `/s/${name}`,
			modifiedAt: new Date(NOW - i * 60_000).toISOString()
		})),
		source: 'x',
		observedAt: null
	});

	it('reads the size, the biggest files and the checks from the task’s record', () => {
		const f = mergeFacts(detail());
		expect(f).toMatchObject({ additions: 110, deletions: 2, files: 3 });
		expect(f.biggest.map((x) => x.path)).toEqual(['b.ts', 'a.ts']);
		expect(f.checks).toEqual({ passed: 2, total: 2, failing: 0, running: 0 });
		expect(f.why).toBeNull();
	});

	it('pairs pictures named before and after, and finds a recording', () => {
		const f = mergeFacts(
			detail({ screenshots: shots(['flow.gif', 'gateway-after.png', 'gateway-before.png']) })
		);
		expect(f.before?.name).toBe('gateway-before.png');
		expect(f.after?.name).toBe('gateway-after.png');
		expect(f.shots).toEqual([]);
		expect(f.recording?.name).toBe('flow.gif');
	});

	it('shows the latest pictures when none are named before and after, and no recording when none was made', () => {
		const f = mergeFacts(detail({ screenshots: shots(['3.png', '2.png', '1.png']) }));
		expect(f.before).toBeNull();
		expect(f.shots.map((s) => s.name)).toEqual(['3.png', '2.png']);
		expect(f.recording).toBeNull();
	});

	it('takes why from what the captain asked, in a short block', () => {
		expect(mergeFacts(detail({}, 'Keep more than one gateway.\n\n(Context: x)')).why).toBe(
			'Keep more than one gateway.'
		);
	});

	it('says nothing it cannot read', () => {
		const f = mergeFacts(null);
		expect(f).toMatchObject({
			additions: null,
			deletions: null,
			files: null,
			checks: null,
			why: null
		});
	});

	it('reads the review’s points from the latest run', () => {
		const step = (state: 'done' | 'upcoming', findings: number, fixes: number | null) =>
			taskSummary('x', 'needs-review', {
				pipeline: {
					step: 'ci',
					label: 'CI',
					startedAt: null,
					round: null,
					steps: [{ key: 'review', label: 'Review', state, findings, fixes, durationMs: null }],
					outcome: 'running',
					gate: null,
					answered: false,
					roundStartedAt: null,
					ci: null,
					observedAt: null
				}
			});
		expect(reviewPoints(step('done', 2, 2))).toEqual({ raised: 2, fixed: 2 });
		expect(reviewPoints(step('upcoming', 0, null))).toBeNull();
		expect(reviewPoints(taskSummary('x', 'working'))).toBeNull();
	});
});
