import { describe, expect, it } from 'vitest';
import {
	checksLine,
	ciChecksLine,
	duration,
	segmentTone,
	showsChecks,
	stepSummary
} from './checks';
import type { CheckStepState, Pipeline, PipelineStep, TaskSummary } from './types';

const KEYS = ['intent', 'rebase', 'review', 'test', 'document', 'lint', 'push', 'pr', 'ci'];
const LABEL: Record<string, string> = {
	intent: 'Intent',
	rebase: 'Rebase',
	review: 'Review',
	test: 'Tests',
	document: 'Docs',
	lint: 'Lint',
	push: 'Push',
	pr: 'Pull request',
	ci: 'CI'
};
const NOW = Date.parse('2026-10-25T12:00:00Z');
const before = (s: number) => new Date(NOW - s * 1000).toISOString();

/** A run at `at` in state `state`: earlier steps done, later ones not reached. */
function run(at: string, state: CheckStepState, o: Partial<Pipeline> = {}): Pipeline {
	const i = KEYS.indexOf(at);
	const steps: PipelineStep[] = KEYS.map((key, j) => ({
		key,
		label: LABEL[key],
		state: j < i ? 'done' : j === i ? state : 'upcoming',
		findings: 0,
		fixes: 0,
		durationMs: j < i ? 1000 : null
	}));
	return {
		step: at,
		label: LABEL[at],
		startedAt: before(80),
		round: null,
		steps,
		outcome: 'running',
		gate: null,
		answered: false,
		roundStartedAt: null,
		ci: null,
		observedAt: before(0),
		...o
	};
}
const withStep = (p: Pipeline, key: string, s: Partial<PipelineStep>): Pipeline => ({
	...p,
	steps: p.steps.map((x) => (x.key === key ? { ...x, ...s } : x))
});

describe('durations', () => {
	it('reads short and long times plainly', () => {
		expect(duration(4_000)).toBe('4s');
		expect(duration(80_000)).toBe('1m 20s');
		expect(duration(120_000)).toBe('2m');
		expect(duration(3_900_000)).toBe('1h 5m');
		expect(duration(7_200_000)).toBe('2h');
		expect(duration(-5)).toBe('0s');
	});
});

describe('the line under the checks strip', () => {
	it('says what each step is doing, and for how long', () => {
		const lines = KEYS.filter((k) => k !== 'ci').map((k) => checksLine(run(k, 'running'), NOW));
		expect(lines).toEqual([
			'Reading the brief · 1m 20s',
			'Catching up with the main branch · 1m 20s',
			'Reviewing the change · 1m 20s',
			'Running the tests · 1m 20s',
			'Checking the docs · 1m 20s',
			'Checking code style · 1m 20s',
			'Pushing the branch · 1m 20s',
			'Opening the pull request · 1m 20s'
		]);
	});

	it('leaves times out when asked for none', () => {
		expect(checksLine(run('review', 'running'), null)).toBe('Reviewing the change');
	});

	it('falls back to the step’s reported duration when its start is unknown', () => {
		const p = withStep(run('test', 'running', { startedAt: null }), 'test', { durationMs: 45_000 });
		expect(checksLine(p, NOW)).toBe('Running the tests · 45s');
	});

	it('says how many questions a gate holds for Firstmate', () => {
		const one = withStep(
			run('review', 'waiting', { gate: { findings: 1, questions: 1, since: before(200) } }),
			'review',
			{ findings: 1, durationMs: 80_000 }
		);
		expect(checksLine({ ...one, startedAt: null }, NOW)).toBe(
			'Reviewing the change · 1m 20s · 1 question for Firstmate'
		);
		const two = run('review', 'waiting', { gate: { findings: 3, questions: 2, since: null } });
		expect(checksLine(two, null)).toBe('Reviewing the change · 2 questions for Firstmate');
	});

	it('says findings wait on Firstmate when a gate holds no questions', () => {
		const p = run('test', 'waiting', { gate: { findings: 2, questions: 0, since: null } });
		expect(checksLine(p, null)).toBe('Running the tests · 2 findings waiting on Firstmate');
		expect(checksLine(run('lint', 'waiting'), null)).toBe(
			'Checking code style · waiting on Firstmate'
		);
	});

	it('names the fix round, and when it follows an answer', () => {
		const p = run('review', 'fixing', { round: 2, roundStartedAt: before(430) });
		expect(checksLine(p, NOW)).toBe('Fixing review findings, round 2 · 7m 10s');
		expect(checksLine({ ...p, answered: true }, NOW)).toBe(
			'Answer received · fixing review findings, round 2 · 7m 10s'
		);
		expect(checksLine(run('test', 'fixing'), null)).toBe('Fixing test failures');
		expect(checksLine(run('ci', 'fixing', { round: 1, ci: 'red' }), null)).toBe(
			'Fixing CI failures, round 1'
		);
	});

	it('says when CI is pending, green or red', () => {
		expect(checksLine(run('ci', 'running', { ci: 'pending' }), NOW)).toBe(
			'Waiting for CI · 1m 20s'
		);
		expect(checksLine(run('ci', 'running', { ci: 'green' }), NOW)).toBe(
			'All checks passed · CI green'
		);
		expect(checksLine(run('ci', 'running', { ci: 'red' }), NOW)).toBe('CI found problems · 1m 20s');
	});

	it('says how a finished run ended', () => {
		expect(checksLine(run('ci', 'done', { outcome: 'passed', ci: 'green' }), NOW)).toBe(
			'All checks passed · CI green'
		);
		expect(checksLine(run('ci', 'done', { outcome: 'passed' }), NOW)).toBe('All checks passed');
		expect(checksLine(run('test', 'failed', { outcome: 'failed' }), NOW)).toBe('Tests failed');
		expect(checksLine(run('review', 'failed', { outcome: 'failed' }), NOW)).toBe('Review failed');
		expect(checksLine(run('test', 'upcoming', { outcome: 'failed' }), NOW)).toBe('Checks failed');
		expect(checksLine(run('ci', 'failed', { outcome: 'cancelled' }), NOW)).toBe(
			'Checks stopped before finishing'
		);
	});

	it('covers a failed step in a run that has not ended, and one not started', () => {
		expect(checksLine(run('push', 'failed'), NOW)).toBe('Could not push the branch');
		expect(checksLine(run('intent', 'upcoming'), NOW)).toBe('Waiting for the checks to start');
	});

	it('never shows step keys, ids or status words', () => {
		const lines = KEYS.flatMap((k) =>
			(['running', 'fixing', 'waiting', 'failed', 'done', 'upcoming'] as const).map((st) =>
				checksLine(run(k, st, { round: 1 }), NOW)
			)
		);
		for (const l of lines) {
			expect(l).not.toMatch(/\b(?:document|awaiting_approval|fix_review|ask-user|pending)\b/);
			expect(l).not.toMatch(/[_=]|\b[0-9A-Z]{26}\b/);
		}
	});
});

describe('what each step found or changed', () => {
	const p = run('ci', 'running', { ci: 'pending' });
	const at = (key: string, s: Partial<PipelineStep>, q: Pipeline = p) =>
		stepSummary({ ...q.steps.find((x) => x.key === key)!, ...s }, q);

	it('says a clean step passed', () => {
		expect(KEYS.slice(0, 8).map((k) => at(k, {}))).toEqual([
			'Brief read',
			'Up to date with the main branch',
			'No issues found',
			'Tests passed',
			'Docs up to date',
			'Code style clean',
			'Branch pushed',
			'Pull request opened'
		]);
	});

	it('says what a step found and how it was fixed', () => {
		expect(at('review', { findings: 3, fixes: 1 })).toBe('Found 3 issues · fixed in 1 round');
		expect(at('review', { findings: 1, fixes: 2 })).toBe('Found 1 issue · fixed in 2 rounds');
		expect(at('review', { findings: 2, fixes: 0 })).toBe('Found 2 issues; no changes needed');
		expect(at('test', { findings: 1, fixes: 0 })).toBe('Tests passed · 1 note');
		expect(at('rebase', { findings: 0, fixes: 1 })).toBe(
			'Up to date with the main branch after 1 round of fixes'
		);
		expect(at('review', { findings: 0, fixes: 2 })).toBe('No issues left after 2 rounds of fixes');
		expect(at('review', { findings: 2, fixes: null })).toBe('Found 2 issues; no changes needed');
	});

	it('describes steps under way, stopped, failed, skipped and not reached', () => {
		expect(at('ci', {})).toBe('Waiting for CI checks');
		expect(at('ci', {}, { ...p, ci: 'green' })).toBe('CI passed; watching until it merges');
		expect(at('ci', {}, { ...p, ci: 'red' })).toBe('CI found problems');
		expect(at('review', { state: 'running' })).toBe('Reviewing the change…');
		const gated = run('review', 'waiting', { gate: { findings: 1, questions: 1, since: null } });
		expect(at('review', {}, gated)).toBe('1 question for Firstmate');
		const fixingRun = run('review', 'fixing', { round: 2 });
		expect(at('review', { findings: 4 }, fixingRun)).toBe(
			'Found 4 issues · fixing review findings, round 2'
		);
		expect(at('test', { state: 'failed', findings: 2 })).toBe('Tests failed · 2 findings');
		expect(at('lint', { state: 'skipped' })).toBe('Skipped');
		expect(at('ci', { state: 'upcoming' })).toBe('');
		expect(at('ci', { state: 'done' }, { ...p, ci: 'red' })).toBe('CI found problems');
		expect(at('ci', { state: 'done' }, { ...p, ci: 'green' })).toBe('CI passed');
	});
});

describe('a pull request’s CI checks in words', () => {
	const c = (...states: ('pass' | 'fail' | 'running' | 'pending' | 'skipped')[]) =>
		states.map((state, i) => ({ name: `c${i}`, state }));
	it('counts passed, failed and running checks', () => {
		expect(ciChecksLine(c('pass', 'pass', 'pass', 'pass'))).toBe('4 of 4 checks passed');
		expect(ciChecksLine(c('pass', 'fail', 'running'))).toBe('1 of 3 checks failed');
		expect(ciChecksLine(c('pass', 'pending', 'running'))).toBe('2 of 3 checks still running');
		expect(ciChecksLine(c('pass'))).toBe('1 of 1 check passed');
		expect(ciChecksLine(c('skipped'))).toBe('1 check reported');
		expect(ciChecksLine([])).toBeNull();
	});
});

describe('the checks strip', () => {
	it('draws passed CI as done, failed CI as failed, and each other state as itself', () => {
		const p = run('ci', 'running', { ci: 'green' });
		const ci = p.steps.at(-1)!;
		expect(segmentTone(ci, p)).toBe('done');
		expect(segmentTone(ci, { ...p, ci: 'red' })).toBe('failed');
		expect(segmentTone({ ...ci, state: 'fixing' }, { ...p, ci: 'red' })).toBe('fixing');
		expect(segmentTone(ci, { ...p, ci: 'pending' })).toBe('active');
		const states: CheckStepState[] = ['done', 'waiting', 'failed', 'skipped', 'upcoming'];
		expect(states.map((state) => segmentTone({ ...p.steps[2], state }, p))).toEqual([
			'done',
			'waiting',
			'failed',
			'skipped',
			'todo'
		]);
	});

	it('shows only for work with a readable run that has not landed', () => {
		const task = (o: Partial<TaskSummary>) =>
			({ status: 'working', pipeline: null, ...o }) as TaskSummary;
		expect(showsChecks(task({ pipeline: run('review', 'running') }))).toBe(true);
		expect(showsChecks(task({ pipeline: { ...run('review', 'running'), steps: [] } }))).toBe(false);
		expect(showsChecks(task({}))).toBe(false);
		expect(showsChecks(task({ status: 'landed', pipeline: run('ci', 'done') }))).toBe(false);
	});
});
