import type { Check, Pipeline, PipelineStep, TaskSummary } from './types';

/**
 * The checks stage (a no-mistakes validation run) in the captain's terms: the
 * one plain line under a card's step strip, and what each step found or
 * changed for the task page's timeline. No step keys, run ids, finding ids or
 * status words reach the UI; only what this module makes of them. Pure, so it
 * is unit-tested.
 */

const DOING: Record<string, string> = {
	intent: 'Reading the brief',
	rebase: 'Catching up with the main branch',
	review: 'Reviewing the change',
	test: 'Running the tests',
	document: 'Checking the docs',
	lint: 'Checking code style',
	push: 'Pushing the branch',
	pr: 'Opening the pull request',
	ci: 'Waiting for CI'
};

const FIXING: Record<string, string> = {
	rebase: 'resolving conflicts with the main branch',
	review: 'fixing review findings',
	test: 'fixing test failures',
	document: 'fixing the docs',
	lint: 'fixing code style',
	ci: 'fixing CI failures'
};

const DONE: Record<string, string> = {
	intent: 'Brief read',
	rebase: 'Up to date with the main branch',
	review: 'No issues found',
	test: 'Tests passed',
	document: 'Docs up to date',
	lint: 'Code style clean',
	push: 'Branch pushed',
	pr: 'Pull request opened',
	ci: 'CI passed'
};

const FAILED: Record<string, string> = {
	rebase: 'Could not catch up with the main branch',
	test: 'Tests failed',
	push: 'Could not push the branch',
	pr: 'Could not open the pull request',
	ci: 'CI failed'
};

// Red CI covers failed checks and other problems the CI monitor reports (a merge
// conflict), so it reads "CI found problems"; "CI failed" is for a failed ci step.
const capitalise = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const doing = (s: PipelineStep) => DOING[s.key] ?? `Running ${s.label.toLowerCase()}`;
const fixing = (key: string) => FIXING[key] ?? 'applying fixes';
const failed = (s: PipelineStep) => FAILED[s.key] ?? `${s.label} failed`;

/** "45s", "1m 20s", "1h 5m": a short, readable duration. */
export function duration(ms: number): string {
	const s = Math.max(0, Math.round(ms / 1000));
	if (s < 60) return `${s}s`;
	const m = Math.floor(s / 60);
	if (m < 60) return s % 60 ? `${m}m ${s % 60}s` : `${m}m`;
	const h = Math.floor(m / 60);
	return m % 60 ? `${h}h ${m % 60}m` : `${h}h`;
}

/** How long a step has taken: live from its start when known, else what the run reported. */
function elapsed(
	s: PipelineStep | null,
	startedAt: string | null,
	now: number | null
): string | null {
	if (now === null) return null;
	const t = startedAt ? Date.parse(startedAt) : NaN;
	if (!Number.isNaN(t)) return duration(now - t);
	return s?.durationMs != null ? duration(s.durationMs) : null;
}

const join = (...parts: (string | null | false | undefined)[]) => parts.filter(Boolean).join(' · ');

/** What a gate is holding, e.g. "1 question for Firstmate". */
function held(p: Pipeline, s: PipelineStep): string {
	const q = p.gate?.questions ?? 0;
	if (q > 0) return count(q, 'question', 'questions') + ' for Firstmate';
	const n = p.gate?.findings || s.findings;
	return n > 0 ? `${count(n, 'finding', 'findings')} waiting on Firstmate` : 'waiting on Firstmate';
}

/** The fix round in words, e.g. "fixing review findings, round 2". */
function fixRound(p: Pipeline, s: PipelineStep): string {
	return `${fixing(s.key)}${p.round ? `, round ${p.round}` : ''}`;
}

const current = (p: Pipeline): PipelineStep | null => p.steps.find((s) => s.key === p.step) ?? null;

/**
 * The one plain line under a card's step strip, e.g. "Reviewing the change ·
 * 1m 20s · 1 question for Firstmate". `now` (epoch ms) adds how long the step
 * has taken; null leaves times out (the server's activity line).
 */
export function checksLine(p: Pipeline, now: number | null): string {
	const green = p.ci === 'green';
	if (p.outcome === 'passed') return green ? 'All checks passed · CI green' : 'All checks passed';
	if (p.outcome === 'cancelled') return 'Checks stopped before finishing';
	const s = current(p);
	if (p.outcome === 'failed') return s?.state === 'failed' ? failed(s) : 'Checks failed';
	if (!s) return `${p.label} step`;
	switch (s.state) {
		case 'waiting':
			return join(doing(s), elapsed(s, null, now), held(p, s));
		case 'fixing':
			return capitalise(
				join(
					p.answered && 'Answer received',
					fixRound(p, s),
					elapsed(s, p.roundStartedAt ?? p.startedAt, now)
				)
			);
		case 'failed':
			return failed(s);
		case 'running':
			if (s.key === 'ci') {
				if (green) return 'All checks passed · CI green';
				if (p.ci === 'red') return join('CI found problems', elapsed(s, p.startedAt, now));
			}
			return join(doing(s), elapsed(s, p.startedAt, now));
		case 'upcoming':
			return 'Waiting for the checks to start';
		default:
			return green ? 'All checks passed · CI green' : 'Checks finished';
	}
}

/** What one step found or changed, for the task page's timeline. Empty for a step not reached. */
export function stepSummary(s: PipelineStep, p: Pipeline): string {
	const n = s.findings;
	const fixes = s.fixes ?? 0;
	switch (s.state) {
		case 'upcoming':
			return '';
		case 'skipped':
			return 'Skipped';
		case 'waiting':
			return capitalise(held(p, s));
		case 'fixing':
			return capitalise(
				join(
					n > 0 && `Found ${count(n, 'issue', 'issues')}`,
					s.key === p.step ? fixRound(p, s) : fixing(s.key)
				)
			);
		case 'failed':
			return join(failed(s), n > 0 && count(n, 'finding', 'findings'));
		case 'running':
			if (s.key === 'ci') {
				if (p.ci === 'green') return 'CI passed; watching until it merges';
				if (p.ci === 'red') return 'CI found problems';
				return 'Waiting for CI checks';
			}
			return `${doing(s)}…`;
		default:
			if (s.key === 'ci' && p.ci === 'red') return 'CI found problems';
			if (s.fixes === null && s.key in FIXING) {
				if (n > 0)
					return `Found ${s.key === 'review' ? count(n, 'issue', 'issues') : count(n, 'note', 'notes')}`;
				return s.key === 'review' ? 'No issues left' : 'No findings left';
			}
			if (n > 0 && fixes > 0)
				return `Found ${count(n, 'issue', 'issues')} · fixed in ${count(fixes, 'round', 'rounds')}`;
			if (n > 0)
				return s.key === 'review'
					? `Found ${count(n, 'issue', 'issues')}; no changes needed`
					: `${DONE[s.key] ?? 'Done'} · ${count(n, 'note', 'notes')}`;
			// A step re-checks after its fixes, so a clean finish can still have changed things.
			if (fixes > 0)
				return `${s.key === 'review' ? 'No issues left' : (DONE[s.key] ?? 'Done')} after ${count(fixes, 'round of fixes', 'rounds of fixes')}`;
			return DONE[s.key] ?? 'Done';
	}
}

/** A pull request's CI checks in a few words, e.g. "4 of 4 checks passed". Null when there are none. */
export function ciChecksLine(checks: readonly Check[]): string | null {
	if (!checks.length) return null;
	const total = checks.length;
	const by = (st: Check['state']) => checks.filter((c) => c.state === st).length;
	const fail = by('fail');
	const waiting = by('running') + by('pending');
	if (fail) return `${fail} of ${total} ${total === 1 ? 'check' : 'checks'} failed`;
	if (waiting) return `${waiting} of ${total} ${total === 1 ? 'check' : 'checks'} still running`;
	const passed = by('pass');
	return passed
		? `${passed} of ${total} ${total === 1 ? 'check' : 'checks'} passed`
		: `${total} ${total === 1 ? 'check' : 'checks'} reported`;
}

/** A card shows the checks strip while a validation run with readable steps is attached to the work. */
export const showsChecks = (t: TaskSummary): t is TaskSummary & { pipeline: Pipeline } =>
	!!t.pipeline?.steps.length && t.status !== 'landed';

/**
 * How a strip segment is drawn: done, the step under way, stopped for an
 * answer, fixing, failed, skipped or not reached. CI that has passed is drawn
 * done even while the monitor keeps watching the pull request.
 */
export type SegmentTone = 'done' | 'active' | 'waiting' | 'fixing' | 'failed' | 'skipped' | 'todo';

export function segmentTone(s: PipelineStep, p: Pipeline): SegmentTone {
	if (s.key === 'ci' && s.state !== 'upcoming' && s.state !== 'skipped') {
		if (p.ci === 'green') return 'done';
		if (p.ci === 'red' && s.state !== 'fixing') return 'failed';
	}
	switch (s.state) {
		case 'done':
			return 'done';
		case 'running':
			return 'active';
		case 'waiting':
			return 'waiting';
		case 'fixing':
			return 'fixing';
		case 'failed':
			return 'failed';
		case 'skipped':
			return 'skipped';
		default:
			return 'todo';
	}
}
