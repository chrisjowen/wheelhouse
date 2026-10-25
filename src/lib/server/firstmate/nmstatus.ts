/**
 * A read of one no-mistakes validation run, from `no-mistakes axi status
 * --run <id>` (TOON output). Wheelhouse only reads it: it never starts,
 * answers or changes a run. The run id comes from Firstmate's crew-state read
 * (the `run: <id>` component fm-crew-state.sh adds once it has selected the
 * task's run), so Wheelhouse does not choose runs itself.
 *
 * Only what the checks strip needs is kept: each step's status, findings and
 * duration, the active step's timers and round, a gate's finding count and how
 * many of its findings are questions (ask-user), and the run's outcome. Finding
 * text is never kept.
 */

import type { CheckStepState, Pipeline, PipelineStep } from '../../types';

/** A parsed TOON value: a scalar, a nested block, or a table of rows. */
type ToonValue = string | ToonBlock | ToonTable;
interface ToonBlock {
	[key: string]: ToonValue;
}
interface ToonTable {
	columns: string[];
	rows: string[][];
}

const isBlock = (v: ToonValue | undefined): v is ToonBlock =>
	!!v && typeof v === 'object' && !('rows' in v);
const isTable = (v: ToonValue | undefined): v is ToonTable =>
	!!v && typeof v === 'object' && 'rows' in v;

/** Split one TOON table row on commas outside double quotes, unquoting each cell. */
export function splitRow(line: string): string[] {
	const out: string[] = [];
	let cur = '';
	let quoted = false;
	for (let i = 0; i < line.length; i++) {
		const c = line[i];
		if (quoted) {
			if (c === '\\' && i + 1 < line.length) cur += line[++i];
			else if (c === '"') quoted = false;
			else cur += c;
		} else if (c === '"') quoted = true;
		else if (c === ',') {
			out.push(cur.trim());
			cur = '';
		} else cur += c;
	}
	out.push(cur.trim());
	return out;
}

const unquote = (s: string) => {
	const t = s.trim();
	return t.length >= 2 && t.startsWith('"') && t.endsWith('"')
		? t.slice(1, -1).replace(/\\(.)/g, '$1')
		: t;
};

const TABLE = /^([\w-]+)\[\d+\]\{([^}]*)\}:\s*$/;
const LIST = /^([\w-]+)\[\d+\]:\s*(.*)$/;
const FIELD = /^([\w-]+):\s*(.*)$/;

/** Parse TOON by indentation into blocks, scalars and tables. Unknown shapes are skipped. */
export function parseToon(text: string): ToonBlock {
	const root: ToonBlock = {};
	const stack: { indent: number; block: ToonBlock }[] = [{ indent: -1, block: root }];
	let table: { indent: number; value: ToonTable } | null = null;
	for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
		if (!raw.trim()) continue;
		const indent = raw.length - raw.trimStart().length;
		const line = raw.trim();
		if (table && indent > table.indent) {
			table.value.rows.push(splitRow(line));
			continue;
		}
		table = null;
		while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
		const parent = stack[stack.length - 1].block;
		const t = TABLE.exec(line);
		if (t) {
			const value: ToonTable = { columns: t[2].split(',').map((c) => c.trim()), rows: [] };
			parent[t[1]] = value;
			table = { indent, value };
			continue;
		}
		const l = LIST.exec(line);
		if (l) {
			parent[l[1]] = l[2];
			continue;
		}
		const f = FIELD.exec(line);
		if (!f) continue;
		if (f[2] === '') {
			const block: ToonBlock = {};
			parent[f[1]] = block;
			stack.push({ indent, block });
		} else {
			parent[f[1]] = unquote(f[2]);
		}
	}
	return root;
}

/** Rows of a table as objects keyed by its columns. */
function records(v: ToonValue | undefined): Record<string, string>[] {
	if (!isTable(v)) return [];
	return v.rows.map((r) => Object.fromEntries(v.columns.map((c, i) => [c, r[i] ?? ''])));
}

const scalar = (b: ToonBlock, k: string): string | null =>
	typeof b[k] === 'string' ? (b[k] as string) : null;

/** "1h2m3s", "14m27s", "3s", "250ms" in seconds; null when it is not a duration. */
export function parseDuration(s: string | null | undefined): number | null {
	const t = (s ?? '').trim();
	if (!t) return null;
	const m = /^(?:(\d+)h)?(?:(\d+)m(?!s))?(?:(\d+(?:\.\d+)?)s)?(?:(\d+)ms)?$/.exec(t);
	if (!m || !m.slice(1).some(Boolean)) return null;
	const [, h, min, sec, ms] = m;
	return Number(h ?? 0) * 3600 + Number(min ?? 0) * 60 + Number(sec ?? 0) + Number(ms ?? 0) / 1000;
}

export interface RunStep {
	step: string;
	/** no-mistakes' own step status: pending, running, fixing, awaiting_approval, fix_review, completed, failed, skipped, … */
	status: string;
	findings: number;
	durationMs: number | null;
}

export interface ActiveStep {
	step: string;
	status: string;
	/** How long the step has been active, in seconds. */
	activeFor: number | null;
	/** How long its current round has been active, in seconds. */
	roundActiveFor: number | null;
	/** The fix round under way ("fix 2"), null for a step's first pass ("round 1"). */
	fixRound: number | null;
}

export interface RunStatus {
	id: string;
	branch: string | null;
	/** The run's status: pending, running, fixing, ci, awaiting_approval, fix_review, completed, failed, cancelled. */
	status: string;
	/** passed, failed, cancelled, … once the run has ended. */
	outcome: string | null;
	/** How long the run has been parked waiting on its driver, in seconds. */
	parkedFor: number | null;
	/** How many findings the run has held for an answer so far ("2 awaiting"). */
	awaiting: number;
	pr: string | null;
	steps: RunStep[];
	active: ActiveStep[];
	/** The gate the run is stopped at: its step, how many findings it holds, and how many are questions. */
	gate: { step: string; status: string; findings: number; questions: number } | null;
}

const num = (s: string | undefined) => {
	const n = Number(s);
	return Number.isFinite(n) ? n : 0;
};

/**
 * The run an `axi status` read describes, or null when the output names none.
 * Run from the run's own branch it is under `run:`; from elsewhere, under
 * `other_branch_run:`; older shapes put its fields at the top level.
 */
export function parseRunStatus(text: string): RunStatus | null {
	const doc = parseToon(text);
	const run = [doc.run, doc.other_branch_run, doc.current_run].find(isBlock) ?? doc;
	const id = scalar(run, 'id');
	const status = scalar(run, 'status');
	if (!id || !status) return null;
	const pick = (k: string) => scalar(run, k) ?? scalar(doc, k);
	const steps = records(run.steps).map((r) => ({
		step: r.step,
		status: r.status,
		findings: num(r.findings),
		durationMs: r.duration_ms === undefined || r.duration_ms === '' ? null : num(r.duration_ms)
	}));
	const active = records(run.active_steps).map((r) => {
		const round = /^fix\s+(\d+)$/i.exec(r.round ?? '');
		return {
			step: r.step,
			status: r.status,
			activeFor: parseDuration(r.active_for),
			roundActiveFor: parseDuration(r.round_active_for),
			fixRound: round ? Number(round[1]) : null
		};
	});
	const gateBlock = [doc.gate, run.gate].find(isBlock) ?? null;
	let gate: RunStatus['gate'] = null;
	if (gateBlock && scalar(gateBlock, 'step')) {
		const findings = records(gateBlock.findings);
		gate = {
			step: scalar(gateBlock, 'step')!,
			status: scalar(gateBlock, 'status') ?? 'awaiting_approval',
			findings: findings.length,
			questions: findings.filter((f) => f.action === 'ask-user').length
		};
	}
	const parked = /^parked\s+(\S+)/.exec(pick('awaiting_agent') ?? '');
	return {
		id,
		branch: pick('branch'),
		status,
		outcome: scalar(doc, 'outcome') ?? scalar(run, 'outcome'),
		parkedFor: parked ? parseDuration(parked[1]) : null,
		awaiting: num(/(\d+)\s+awaiting/.exec(pick('findings') ?? '')?.[1]),
		pr: pick('pr'),
		steps,
		active,
		gate
	};
}

/** no-mistakes pipeline steps, in order, with their plain labels. */
export const STEPS: [key: string, label: string][] = [
	['intent', 'Intent'],
	['rebase', 'Rebase'],
	['review', 'Review'],
	['test', 'Tests'],
	['document', 'Docs'],
	['lint', 'Lint'],
	['push', 'Push'],
	['pr', 'Pull request'],
	['ci', 'CI']
];
export const STEP_LABEL = new Map(STEPS);

const STEP_STATE: Record<string, CheckStepState> = {
	completed: 'done',
	running: 'running',
	fixing: 'fixing',
	awaiting_approval: 'waiting',
	fix_review: 'waiting',
	failed: 'failed',
	cancelled: 'failed',
	skipped: 'skipped',
	pending: 'upcoming'
};

const PASSED = new Set(['passed', 'passed-with-override', 'passed-with-skips', 'checks-passed']);

/** What the step logs add to a status read: fix commits per step, and the current step's log. */
export interface StepLogFacts {
	/** Fix commits each step's log records, by step key. */
	fixes: Map<string, number>;
	/** The current step's latest fix round followed an answer (a user-fix round). */
	answeredRound: boolean;
	/** When the current step started, from its log, if known. */
	startedAt: string | null;
}

/** The CI result a ci step log reports now (see evidence.ts ciResultFromLog). */
export type CiResult = 'pending' | 'green' | 'red' | 'unknown';

/**
 * A Pipeline from a run's status read: every step's state, the current step,
 * a gate's questions, the fix round under way and the CI result.
 */
export function pipelineFromRun(
	run: RunStatus,
	observedAtMs: number,
	logs: StepLogFacts,
	ci: CiResult
): Pipeline {
	const iso = (ms: number) => new Date(ms).toISOString();
	const ago = (s: number | null) => (s === null ? null : iso(observedAtMs - s * 1000));
	const active = new Map(run.active.map((a) => [a.step, a]));
	const steps: PipelineStep[] = run.steps
		.filter((s) => STEP_LABEL.has(s.step))
		.map((s) => {
			const a = active.get(s.step);
			let state = STEP_STATE[a?.status ?? s.status] ?? 'upcoming';
			if (run.gate?.step === s.step && state !== 'done') state = 'waiting';
			return {
				key: s.step,
				label: STEP_LABEL.get(s.step)!,
				state,
				findings: s.findings,
				fixes: logs.fixes.get(s.step) ?? null,
				durationMs:
					a?.activeFor != null
						? Math.round(a.activeFor * 1000)
						: s.durationMs && s.durationMs > 0
							? s.durationMs
							: null
			};
		});
	const outcome: Pipeline['outcome'] = PASSED.has(run.outcome ?? '')
		? 'passed'
		: run.outcome === 'failed' || (!run.outcome && run.status === 'failed')
			? 'failed'
			: run.outcome === 'cancelled' || (!run.outcome && run.status === 'cancelled')
				? 'cancelled'
				: !run.outcome && run.status === 'completed'
					? 'passed'
					: 'running';
	// The current step: the one at work or stopped, else the first not reached, else the last.
	const at =
		steps.findIndex((s) => ['running', 'fixing', 'waiting', 'failed'].includes(s.state)) >= 0
			? steps.findIndex((s) => ['running', 'fixing', 'waiting', 'failed'].includes(s.state))
			: outcome === 'running' && steps.some((s) => s.state === 'upcoming')
				? steps.findIndex((s) => s.state === 'upcoming')
				: steps.length - 1;
	const current = steps[at] ?? null;
	const a = current ? active.get(current.key) : undefined;
	const ciStep = steps.find((s) => s.key === 'ci');
	let ciState: Pipeline['ci'] = null;
	if (ciStep && ciStep.state !== 'upcoming' && ciStep.state !== 'skipped') {
		if (ci === 'green' || ci === 'red') ciState = ci;
		else if (ciStep.state === 'done') ciState = 'green';
		else if (ciStep.state === 'failed' || ciStep.state === 'fixing') ciState = 'red';
		else ciState = 'pending';
	}
	const waiting = current?.state === 'waiting';
	return {
		step: current?.key ?? 'intent',
		label: current?.label ?? 'Intent',
		startedAt: ago(a?.activeFor ?? null) ?? logs.startedAt,
		round: current?.state === 'fixing' ? (a?.fixRound ?? null) : null,
		steps,
		outcome,
		gate: waiting
			? {
					findings: run.gate?.findings ?? current.findings,
					questions: run.gate?.questions ?? 0,
					since: ago(run.parkedFor)
				}
			: null,
		answered: current?.state === 'fixing' && logs.answeredRound,
		roundStartedAt: current?.state === 'fixing' ? ago(a?.roundActiveFor ?? null) : null,
		ci: ciState,
		observedAt: iso(observedAtMs)
	};
}
