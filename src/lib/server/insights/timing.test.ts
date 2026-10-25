import { describe, expect, it } from 'vitest';
import { estimate, splitTime, waited, type StatusLine, type TimingInput } from './timing';

// Synthetic timelines only. Times are seconds from T0.
const T0 = 1_000_000;
const at = (m: number) => T0 + m * 60;
const line = (m: number, state: string, text = '', key: string | null = null): StatusLine => ({
	ts: at(m),
	state,
	key,
	text
});

function ship(over: Partial<TimingInput> = {}): TimingInput {
	return {
		id: 'alpha',
		kind: 'ship',
		project: 'demo',
		dispatchedAt: at(0),
		statuses: [
			line(1, 'working', 'setup done'),
			line(20, 'paused', 'no-mistakes run started in background'),
			line(25, 'needs-decision', 'ask-user findings=a', 'nm-RUN-review'),
			line(27, 'resolved', 'answered: FIX it', 'nm-RUN-review'),
			line(27, 'paused', 'review fix round running'),
			line(50, 'done', 'PR https://example.test/pull/1 checks green')
		],
		mergedAt: null,
		cleanedUpAt: null,
		live: true,
		runs: [
			{
				id: 'RUN',
				noCi: false,
				steps: [
					{ step: 'rebase', startedAt: at(20), endedAt: at(21) },
					{ step: 'review', startedAt: at(21), endedAt: at(35) },
					{ step: 'test', startedAt: at(35), endedAt: at(40) },
					{ step: 'pr', startedAt: at(40), endedAt: at(42) },
					{ step: 'ci', startedAt: at(42), endedAt: at(80) }
				]
			}
		],
		...over
	};
}

describe('waited', () => {
	it('counts from the question to its answer', () => {
		const s = [line(0, 'needs-decision', '', 'k'), line(4, 'resolved', '', 'k')];
		expect(waited(s, () => true, at(10)).total).toBe(240);
	});

	it('stops counting once the worker reports progress on something else', () => {
		const s = [
			line(0, 'needs-decision', '', 'k'),
			line(1, 'paused', 'fix round'),
			line(9, 'resolved', '', 'k')
		];
		expect(waited(s, () => true, at(10)).total).toBe(60);
	});

	it('runs an open question to the end and says it is open', () => {
		const r = waited([line(0, 'needs-decision', '', 'k')], () => true, at(5));
		expect(r).toMatchObject({ total: 300, open: true });
	});
});

describe('splitTime', () => {
	it('splits a ship task that passed its checks', () => {
		const s = splitTime(ship(), at(70));
		expect(s.seconds.build).toBe(20 * 60);
		expect(s.seconds.deciding).toBe(2 * 60);
		expect(s.seconds.ci).toBe(8 * 60);
		expect(s.seconds.review).toBe((50 - 20 - 2 - 8) * 60);
		expect(s.seconds.captain).toBe(20 * 60);
		expect(s.phase).toBe('captain');
		expect(s.readyAfter).toBe(50 * 60);
		expect(s.ongoing).toBe(true);
		expect(s.reviewSteps.map((x) => x.label)).toEqual([
			'Catching up with main',
			'Code review',
			'Tests',
			'Pull request'
		]);
	});

	it('counts no CI time for a repository without CI', () => {
		const t = ship();
		t.runs[0].noCi = true;
		expect(splitTime(t, at(70)).seconds.ci).toBe(0);
	});

	it('ends at the merge and calls it landed', () => {
		const s = splitTime(ship({ mergedAt: at(60), live: false }), at(500));
		expect(s.phase).toBe('landed');
		expect(s.seconds.captain).toBe(10 * 60);
		expect(s.ongoing).toBe(false);
	});

	it('is still building before any validation run', () => {
		const s = splitTime(ship({ statuses: [line(1, 'working', 'setup')], runs: [] }), at(12));
		expect(s.phase).toBe('building');
		expect(s.seconds.build).toBe(12 * 60);
		expect(s.readyAfter).toBeNull();
	});

	it('is in CI while the ci step runs and nothing is green yet', () => {
		const t = ship({ statuses: ship().statuses.slice(0, 5) });
		const s = splitTime(t, at(45));
		expect(s.phase).toBe('ci');
		expect(s.phaseStartedAt).toBe(at(42));
	});

	it('counts time back in review after passing as review again', () => {
		const t = ship();
		t.runs.push({
			id: 'RUN2',
			noCi: false,
			steps: [{ step: 'rebase', startedAt: at(60), endedAt: at(61) }]
		});
		const s = splitTime(t, at(65));
		expect(s.phase).toBe('review');
		expect(s.phaseStartedAt).toBe(at(60));
		expect(s.seconds.captain).toBe(10 * 60);
		expect(s.seconds.review).toBe((20 + 5) * 60);
	});

	it('waits on you again once a second run passes its checks', () => {
		const t = ship();
		t.statuses.push(
			line(55, 'paused', 'no-mistakes run started in background'),
			line(70, 'done', 'PR https://example.test/pull/1 checks green')
		);
		t.runs.push({
			id: 'RUN2',
			noCi: false,
			steps: [
				{ step: 'rebase', startedAt: at(55), endedAt: at(56) },
				{ step: 'review', startedAt: at(56), endedAt: at(62) },
				{ step: 'ci', startedAt: at(64), endedAt: at(90) }
			]
		});
		const s = splitTime(t, at(80));
		expect(s.phase).toBe('captain');
		expect(s.phaseStartedAt).toBe(at(70));
		expect(s.seconds.captain).toBe(10 * 60);
		expect(s.seconds.ci).toBe(6 * 60);
		expect(s.seconds.review).toBe((70 - 20 - 2 - 6) * 60);
		expect(s.readyAfter).toBe(70 * 60);
	});

	it('counts a question asked after the checks passed once, as waiting on you', () => {
		const t = ship();
		t.statuses.push(
			line(55, 'needs-decision', 'live at http://127.0.0.1:1 - review', 'board-review')
		);
		const s = splitTime(t, at(70));
		expect(s.seconds.captain).toBe(20 * 60);
		expect(s.total).toBe(70 * 60);
		expect(s.readyAfter).toBe(50 * 60);
	});

	it('takes time waiting on the captain out of building and review', () => {
		const t = ship();
		t.statuses.push(
			line(5, 'needs-decision', 'which approach?', 'board-q1'),
			line(15, 'resolved', 'answered: the first', 'board-q1'),
			line(30, 'needs-decision', 'which copy?', 'board-q2'),
			line(33, 'resolved', 'answered: the short one', 'board-q2')
		);
		const s = splitTime(t, at(70));
		expect(s.seconds.build).toBe(10 * 60);
		expect(s.seconds.review).toBe((50 - 20 - 2 - 8 - 3) * 60);
		expect(s.seconds.captain).toBe((10 + 3 + 20) * 60);
		expect(s.total).toBe(70 * 60);
		expect(s.readyAfter).toBe((50 - 13) * 60);
	});

	it('counts questions open at the same time once', () => {
		const t = ship();
		t.statuses.push(
			line(5, 'needs-decision', 'which approach?', 'board-q1'),
			line(6, 'needs-decision', 'which copy?', 'board-q2'),
			line(15, 'resolved', 'answered: the first', 'board-q1'),
			line(15, 'resolved', 'answered: the short one', 'board-q2')
		);
		const s = splitTime(t, at(70));
		expect(s.seconds.build).toBe(10 * 60);
		expect(s.readyAfter).toBe((50 - 10) * 60);
		expect(s.seconds.captain).toBe((10 + 20) * 60);
		expect(s.total).toBe(70 * 60);
	});

	it('counts a review question and a question for the captain open together once', () => {
		const t = ship();
		t.statuses.push(
			line(24, 'needs-decision', 'which copy?', 'board-q'),
			line(26, 'resolved', 'answered: the short one', 'board-q')
		);
		const s = splitTime(t, at(70));
		expect(s.seconds.deciding).toBe(1 * 60);
		expect(s.seconds.review).toBe((50 - 20 - 3 - 8) * 60);
		expect(s.seconds.captain).toBe((2 + 20) * 60);
		expect(s.total).toBe(70 * 60);
	});

	it('counts a question asked back in review once', () => {
		const t = ship();
		t.runs.push({
			id: 'RUN2',
			noCi: false,
			steps: [{ step: 'rebase', startedAt: at(60), endedAt: at(61) }]
		});
		t.statuses.push(line(62, 'needs-decision', 'which copy?', 'board-q'));
		const s = splitTime(t, at(65));
		expect(s.seconds.captain).toBe((10 + 3) * 60);
		expect(s.seconds.review).toBe((20 + 2) * 60);
		expect(s.total).toBe(65 * 60);
	});

	it('counts a prototype as building, less the time it waited on the captain', () => {
		const s = splitTime(
			{
				...ship({ kind: 'scout', runs: [] }),
				statuses: [
					line(30, 'needs-decision', 'live at http://127.0.0.1:1 - review', 'board-review'),
					line(40, 'resolved', 'answered: looks good', 'board-review')
				]
			},
			at(60)
		);
		expect(s.seconds.build).toBe(50 * 60);
		expect(s.seconds.captain).toBe(10 * 60);
		expect(s.phase).toBe('building');
	});

	it('ignores runs from before the task was dispatched', () => {
		const t = ship({ dispatchedAt: at(100), statuses: [], live: true });
		expect(splitTime(t, at(110)).reviewSteps).toEqual([]);
	});
});

describe('estimate', () => {
	// Finished history: build b, review r (minutes), CI 2 min, then ready.
	function done(id: string, b: number, r: number, project = 'demo') {
		const statuses = [
			line(b, 'paused', 'no-mistakes run started'),
			line(b + r + 2, 'done', 'PR checks green')
		];
		const runs = [
			{
				id: `R${id}`,
				noCi: false,
				steps: [
					{ step: 'review', startedAt: at(b), endedAt: at(b + r) },
					{ step: 'ci', startedAt: at(b + r), endedAt: at(b + r + 9) }
				]
			}
		];
		const t = ship({ id, project, statuses, runs, mergedAt: at(b + r + 5), live: false });
		return { split: splitTime(t, at(1000)), kind: 'ship', project };
	}
	const live = (phase: 'building' | 'review', inPhase: number, project = 'demo') => {
		const statuses =
			phase === 'review' ? [line(10, 'paused', 'no-mistakes run started')] : [line(1, 'working')];
		const t = ship({ id: 'now', project, statuses, runs: [] });
		const now = phase === 'review' ? at(10 + inPhase) : at(inPhase);
		return { subject: { split: splitTime(t, now), kind: 'ship', project }, now };
	};

	it('says prototypes and scouting have no set end', () => {
		const t = ship({ kind: 'scout' });
		const e = estimate({ split: splitTime(t, at(5)), kind: 'scout', project: 'demo' }, [], at(5));
		expect(e.openEnded).toBe(true);
		expect(e.minutes).toBeNull();
	});

	it('gives no estimate when nothing similar has finished', () => {
		const { subject, now } = live('building', 5);
		const e = estimate(subject, [], now);
		expect(e.minutes).toBeNull();
		expect(e.confidence).toBe('none');
	});

	it('calls one or two finished tasks an early guess', () => {
		const { subject, now } = live('building', 5);
		const e = estimate(subject, [done('a', 10, 10), done('b', 20, 20)], now);
		expect(e.confidence).toBe('early');
		expect(e.basis).toBe(2);
		expect(e.minutes).toBeGreaterThan(0);
	});

	it('uses what similar work still had left once this far into the phase', () => {
		const history = ['a', 'b', 'c', 'd'].map((id, i) => done(id, 10, 10 + i * 2));
		const { subject, now } = live('review', 4);
		const e = estimate(subject, history, now);
		// review 10-16 min, 4 in: 6-12 left, plus 2 min CI
		expect(e.minutes).toBe(Math.round((6 + 12) / 2 + 2));
		expect(e.scope).toBe('project');
		expect(e.ahead.map((a) => a.phase)).toEqual(['review', 'ci']);
		expect(e.ahead[0].current).toBe(true);
	});

	it('says taking longer than usual instead of going below zero', () => {
		const history = ['a', 'b', 'c'].map((id) => done(id, 10, 10));
		const { subject, now } = live('review', 30);
		const e = estimate(subject, history, now);
		expect(e.overdue).toBe(true);
		expect(e.minutes).toBeGreaterThanOrEqual(1);
	});

	it('falls back to work across projects when this project has little history', () => {
		const history = [
			done('a', 10, 10, 'other'),
			done('b', 12, 10, 'other'),
			done('c', 8, 10, 'demo')
		];
		const { subject, now } = live('building', 2);
		const e = estimate(subject, history, now);
		expect(e.scope).toBe('kind');
		expect(e.basis).toBe(3);
	});

	it('is only a good guide when plenty of history agrees', () => {
		const agree = Array.from({ length: 9 }, (_, i) => done(`a${i}`, 10, 10));
		const disagree = Array.from({ length: 9 }, (_, i) => done(`d${i}`, 5 + i * 15, 10));
		const { subject, now } = live('building', 1);
		expect(estimate(subject, agree, now).confidence).toBe('guide');
		expect(estimate(subject, disagree, now).confidence).toBe('rough');
	});

	it('never counts the task itself as history', () => {
		const { subject, now } = live('building', 1);
		const self = { ...subject, split: { ...subject.split, readyAfter: 60 } };
		expect(estimate(subject, [self], now).basis).toBe(0);
	});
});
