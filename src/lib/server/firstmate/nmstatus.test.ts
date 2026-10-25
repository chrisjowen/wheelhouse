import { describe, expect, it } from 'vitest';
import { parseDuration, parseRunStatus, pipelineFromRun, splitRow } from './nmstatus';

const RUN = '01M5RWB8270YVD3EX1X1MKQYCG';
const NOW = Date.parse('2026-10-25T12:00:00Z');
const noLogs = { fixes: new Map<string, number>(), answeredRound: false, startedAt: null };

/** A run parked at review on one ask-user finding, read from another branch (real shape). */
const PARKED = `current_branch: fm/other
other_branch_run:
  id: "${RUN}"
  branch: fm/a
  status: running
  awaiting_agent: parked 3m43s
  head: 50fa2fc5
  verification_plan: none
  findings: 1 awaiting
  steps[9]{step,status,findings,duration_ms}:
    intent,completed,0,4
    rebase,completed,0,2940
    review,awaiting_approval,1,78864
    test,pending,0,0
    document,pending,0,0
    lint,pending,0,0
    push,pending,0,0
    pr,pending,0,0
    ci,pending,0,0
gate:
  step: review
  status: awaiting_approval
  risk: medium
  note: "Parks for a decision (\`auto_fix.review: 0\`)."
  findings[2]{id,severity,file,action,description}:
    some-question,warning,src/a.ts,ask-user,"Intent: \\"x\\", y, z"
    some-fix,error,src/b.ts,auto-fix,plain words
help[1]: Run \`no-mistakes axi logs --run ${RUN}\` to read the log
`;

/** A run in its first review fix round, read from its own branch. */
const FIXING = `run:
  id: "${RUN}"
  branch: fm/a
  status: running
  findings: "2 awaiting, 4 auto-fix"
  steps[9]{step,status,findings,duration_ms}:
    intent,completed,0,4
    rebase,completed,0,2505
    review,fixing,6,176372
    test,pending,0,0
    document,pending,0,0
    lint,pending,0,0
    push,pending,0,0
    pr,pending,0,0
    ci,pending,0,0
  active_steps[1]{step,status,active_for,round_active_for,last_activity,agent_pid,round}:
    review,fixing,14m27s,7m10s,"3s ago: log: Still reviewing, checking things.","91608",fix 1
`;

const steps = (rows: string) => `run:
  id: "${RUN}"
  branch: fm/a
  status: running
  steps[9]{step,status,findings,duration_ms}:
${rows
	.trim()
	.split('\n')
	.map((r) => `    ${r.trim()}`)
	.join('\n')}
`;

describe('reading a no-mistakes run status', () => {
	it('splits table rows on commas outside quotes', () => {
		expect(splitRow('a,"b, \\"c\\"",d')).toEqual(['a', 'b, "c"', 'd']);
		expect(splitRow('review,fixing,14m27s,"3s ago: x, y","91608",fix 1')).toEqual([
			'review',
			'fixing',
			'14m27s',
			'3s ago: x, y',
			'91608',
			'fix 1'
		]);
	});

	it('reads durations', () => {
		expect(parseDuration('3m43s')).toBe(223);
		expect(parseDuration('14m27s')).toBe(867);
		expect(parseDuration('1h2m3s')).toBe(3723);
		expect(parseDuration('3s')).toBe(3);
		expect(parseDuration('250ms')).toBe(0.25);
		expect(parseDuration('soon')).toBeNull();
		expect(parseDuration('')).toBeNull();
	});

	it('reads a run parked on a question, from another branch', () => {
		const r = parseRunStatus(PARKED)!;
		expect(r).toMatchObject({
			id: RUN,
			branch: 'fm/a',
			status: 'running',
			outcome: null,
			parkedFor: 223,
			awaiting: 1,
			gate: { step: 'review', status: 'awaiting_approval', findings: 2, questions: 1 }
		});
		expect(r.steps.map((s) => s.step)).toEqual([
			'intent',
			'rebase',
			'review',
			'test',
			'document',
			'lint',
			'push',
			'pr',
			'ci'
		]);
		expect(r.steps[2]).toEqual({
			step: 'review',
			status: 'awaiting_approval',
			findings: 1,
			durationMs: 78864
		});
	});

	it('reads the active step, its timers and its fix round', () => {
		const r = parseRunStatus(FIXING)!;
		expect(r.awaiting).toBe(2);
		expect(r.active).toEqual([
			{ step: 'review', status: 'fixing', activeFor: 867, roundActiveFor: 430, fixRound: 1 }
		]);
		expect(r.gate).toBeNull();
	});

	it('reads a finished run’s outcome and pull request', () => {
		const r = parseRunStatus(
			`${steps('ci,completed,0,465760')}  pr: "https://github.com/o/r/pull/7"\noutcome: passed\n`
		)!;
		expect(r.outcome).toBe('passed');
		expect(r.pr).toBe('https://github.com/o/r/pull/7');
	});

	it('is null for output that names no run', () => {
		expect(parseRunStatus('error: "run \\"x\\" not found"\n')).toBeNull();
		expect(parseRunStatus('')).toBeNull();
	});
});

describe('a run as a pipeline', () => {
	it('places a parked run at its gate, with its questions and how long it has waited', () => {
		const p = pipelineFromRun(parseRunStatus(PARKED)!, NOW, noLogs, 'unknown');
		expect(p).toMatchObject({
			step: 'review',
			label: 'Review',
			outcome: 'running',
			round: null,
			gate: { findings: 2, questions: 1, since: '2026-10-25T11:56:17.000Z' },
			ci: null
		});
		expect(p.steps.map((s) => s.state)).toEqual([
			'done',
			'done',
			'waiting',
			'upcoming',
			'upcoming',
			'upcoming',
			'upcoming',
			'upcoming',
			'upcoming'
		]);
		expect(p.steps[2]).toMatchObject({ findings: 1, durationMs: 78864, fixes: null });
	});

	it('places a fixing run at its fix round, answered when the log says so', () => {
		const run = parseRunStatus(FIXING)!;
		const logs = { fixes: new Map([['review', 1]]), answeredRound: true, startedAt: null };
		const p = pipelineFromRun(run, NOW, logs, 'unknown');
		expect(p).toMatchObject({
			step: 'review',
			round: 1,
			answered: true,
			gate: null,
			startedAt: '2026-10-25T11:45:33.000Z',
			roundStartedAt: '2026-10-25T11:52:50.000Z'
		});
		expect(p.steps[2]).toMatchObject({
			state: 'fixing',
			findings: 6,
			fixes: 1,
			durationMs: 867000
		});
		expect(pipelineFromRun(run, NOW, noLogs, 'unknown').answered).toBe(false);
	});

	it('reads CI from the ci step and its log', () => {
		const at = (ci: string, result: 'pending' | 'green' | 'red' | 'unknown') =>
			pipelineFromRun(
				parseRunStatus(steps(`review,completed,0,1\npr,completed,0,1\nci,${ci},0,0`))!,
				NOW,
				noLogs,
				result
			).ci;
		expect(at('running', 'unknown')).toBe('pending');
		expect(at('running', 'pending')).toBe('pending');
		expect(at('running', 'green')).toBe('green');
		expect(at('running', 'red')).toBe('red');
		expect(at('fixing', 'unknown')).toBe('red');
		expect(at('completed', 'unknown')).toBe('green');
		expect(at('pending', 'green')).toBeNull();
	});

	it('reads the outcome of a finished run', () => {
		const out = (tail: string) =>
			pipelineFromRun(
				parseRunStatus(`${steps('test,failed,2,10\nci,pending,0,0')}${tail}`)!,
				NOW,
				noLogs,
				'unknown'
			);
		expect(out('outcome: failed\n')).toMatchObject({ outcome: 'failed', step: 'test' });
		expect(out('outcome: cancelled\n').outcome).toBe('cancelled');
		expect(out('outcome: passed-with-skips\n').outcome).toBe('passed');
		expect(out('').outcome).toBe('running');
	});

	it('skips steps it does not know', () => {
		const p = pipelineFromRun(
			parseRunStatus(steps('review,completed,0,1\nmystery,running,0,0'))!,
			NOW,
			noLogs,
			'unknown'
		);
		expect(p.steps.map((s) => s.key)).toEqual(['review']);
	});
});
