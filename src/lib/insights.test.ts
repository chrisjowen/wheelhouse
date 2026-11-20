import { describe, expect, it } from 'vitest';
import {
	byDay,
	decisionHref,
	decisionsHref,
	decisionsPage,
	decisionsQuery,
	duration,
	etaLine,
	minutes,
	sumSplits,
	total
} from './insights';
import type { DecisionsView, DecisionView, Verdict, WorkEta } from './types';

const eta = (over: Partial<WorkEta>): WorkEta => ({
	openEnded: false,
	minutes: 20,
	low: 15,
	high: 30,
	basis: 5,
	scope: 'project',
	confidence: 'rough',
	overdue: false,
	elapsed: 600,
	ahead: [],
	...over
});

describe('durations', () => {
	it('reads naturally', () => {
		expect(duration(42)).toBe('42s');
		expect(duration(600)).toBe('10 min');
		expect(minutes(65)).toBe('1h 5m');
		expect(minutes(120)).toBe('2h');
		expect(minutes(3 * 1440)).toBe('3 days');
	});
});

describe('etaLine', () => {
	it('gives the estimate with its basis', () => {
		expect(etaLine(eta({}))).toMatchObject({ text: 'About 20 min left', tone: 'normal' });
		expect(etaLine(eta({})).note).toContain('Based on 5 similar tasks in this project.');
	});
	it('says when work is taking longer than usual', () => {
		expect(etaLine(eta({ overdue: true }))).toMatchObject({
			text: 'Taking longer than usual',
			tone: 'warning'
		});
	});
	it('shows time under way for open-ended work', () => {
		expect(etaLine(eta({ openEnded: true, minutes: null, elapsed: 4500 })).text).toBe(
			'Under way 1h 15m · no set end'
		);
	});
	it('says when there is no estimate yet', () => {
		expect(etaLine(eta({ minutes: null })).text).toBe('No estimate yet');
	});
});

describe('splits', () => {
	it('adds splits per segment', () => {
		const s = sumSplits([
			{ seconds: { build: 1, review: 2, deciding: 0, ci: 3, captain: 4 } },
			{ seconds: { build: 1, review: 0, deciding: 1, ci: 0, captain: 0 } }
		]);
		expect(s).toEqual({ build: 2, review: 2, deciding: 1, ci: 3, captain: 4 });
		expect(total(s)).toBe(12);
	});
});

describe('byDay', () => {
	it('groups under Today and Yesterday', () => {
		const now = new Date('2026-03-10T15:00:00').getTime();
		const g = byDay(
			['2026-03-10T09:00:00', '2026-03-10T08:00:00', '2026-03-09T20:00:00'],
			(x) => new Date(x).toISOString(),
			now
		);
		expect(g.map(([k, v]) => [k, v.length])).toEqual([
			['Today', 2],
			['Yesterday', 1]
		]);
	});
});

describe('decisionsPage', () => {
	const decision = (i: number, verdict: Verdict): DecisionView => ({
		id: `d${i}`,
		taskId: `t${i}`,
		taskTitle: `Task ${i}`,
		projectId: null,
		step: 'review',
		askedAt: '2026-11-01T10:00:00Z',
		decidedAt: '2026-11-01T10:01:00Z',
		verdict,
		calls: [{ question: 'q', detail: '', file: null, serious: false, verdict, reason: 'r' }],
		answerCut: false,
		landed: true
	});
	// 250 decisions, newest first: every fifth is Defer, the rest Fix it.
	const view: DecisionsView = {
		schema: 'wheelhouse-decisions.v1',
		available: true,
		reason: null,
		decisions: Array.from({ length: 250 }, (_, i) => decision(i, i % 5 ? 'Fix it' : 'Defer'))
	};
	const q = (s: string) => decisionsQuery(new URLSearchParams(s));

	it('sends one page of the decisions, never all of them', () => {
		const first = decisionsPage(view, q(''), 100);
		expect(first.decisions.map((d) => d.id)).toEqual(view.decisions.slice(0, 100).map((d) => d.id));
		expect(first.page).toEqual({
			number: 1,
			pages: 3,
			size: 100,
			verdict: 'All',
			matching: 250,
			total: 250
		});
		const last = decisionsPage(view, q('page=3'), 100);
		expect(last.decisions.map((d) => d.id)[0]).toBe('d200');
		expect(last.decisions).toHaveLength(50);
		// Past the end: the last page.
		expect(decisionsPage(view, q('page=9'), 100).page?.number).toBe(3);
	});

	it('filters on the server, counting what matches on every page', () => {
		const p = decisionsPage(view, q('verdict=Defer'), 20);
		expect(p.decisions.every((d) => d.verdict === 'Defer')).toBe(true);
		expect(p.page).toMatchObject({ verdict: 'Defer', matching: 50, total: 250, pages: 3 });
		// An unknown filter is All.
		expect(decisionsPage(view, q('verdict=Nope'), 20).page?.verdict).toBe('All');
	});

	it('finds the page holding a linked decision, under All when the filter hides it', () => {
		expect(decisionsPage(view, q('d=d150'), 100).page?.number).toBe(2);
		const found = decisionsPage(view, q('verdict=Defer&d=d151'), 100);
		expect(found.page).toMatchObject({ verdict: 'All', number: 2 });
		expect(found.decisions.some((d) => d.id === 'd151')).toBe(true);
	});

	it('links to a page and to one decision', () => {
		expect(decisionsHref('All')).toBe('/decisions');
		expect(decisionsHref('Keep as is', 2)).toBe('/decisions?verdict=Keep+as+is&page=2');
		expect(decisionHref('nm-r1-review-17')).toBe('/decisions?d=nm-r1-review-17#nm-r1-review-17');
	});
});
