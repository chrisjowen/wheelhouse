import { duration } from './insights';
import { plural } from './format';
import type { ChangeRequest, TaskRun, TaskRuns, TaskSummary } from './types';

/**
 * How a task's runs and the changes that started them read: the checklist's
 * words, the run switcher's lines and the one-line count cards show. Pure, so
 * the server-derived runs (server/firstmate/changes.ts) read the same everywhere.
 */

/** Where a request came from, in plain words. */
export const SOURCE_LABEL: Record<ChangeRequest['kind'], string> = {
	review: 'GitHub review',
	thread: 'GitHub review comment',
	comment: 'GitHub comment',
	preview: 'Preview feedback',
	'pr-review': 'Wheelhouse PR review',
	decision: 'Decisions inbox'
};

export const STATE_LABEL: Record<ChangeRequest['state'], string> = {
	open: 'To do',
	resolved: 'Resolved on GitHub',
	addressed: 'Worker reported it ready since'
};

export const OUTCOME_LABEL: Record<TaskRun['outcome'], string> = {
	building: 'In progress',
	ready: 'Ready for your review',
	'changes-requested': 'Changes requested',
	landed: 'Landed',
	closed: 'Closed'
};

/** The file and line a request is on, e.g. "src/a.ts, line 7". */
export const changeWhere = (c: ChangeRequest): string | null =>
	c.where ? `${c.where.path}${c.where.line != null ? `, line ${c.where.line}` : ''}` : null;

/** The requests still to do, then the ones done (resolved or addressed), each oldest first. */
export function splitChanges(items: ChangeRequest[]): {
	open: ChangeRequest[];
	done: ChangeRequest[];
} {
	return {
		open: items.filter((c) => c.state === 'open'),
		done: items.filter((c) => c.state !== 'open')
	};
}

/** The count line, e.g. "2 changes to make · 1 done"; null when nothing was requested. */
export function changesLine(items: ChangeRequest[] | null | undefined): string | null {
	if (!items?.length) return null;
	const { open, done } = splitChanges(items);
	return [
		open.length ? `${open.length} ${plural(open.length, 'change', 'changes')} to make` : null,
		done.length ? `${done.length} done` : null
	]
		.filter(Boolean)
		.join(' · ');
}

/** The task's current run, when it has had more than one. */
export const laterRun = (t: Pick<TaskSummary, 'runs'>): TaskRun | null =>
	t.runs && t.runs.current > 1 ? (t.runs.runs.at(-1) ?? null) : null;

/** "Run 2 · Building" for a task on a later run; null for a first run. */
export function runStep(t: Pick<TaskSummary, 'runs' | 'passage'>): string | null {
	if (!t.runs || t.runs.current < 2) return null;
	const step = t.passage.steps[t.passage.current];
	return step ? `Run ${t.runs.current} · ${step.label}` : `Run ${t.runs.current}`;
}

/** The run a moment belongs to: the latest that had started by then (run 1 before any start). */
export function runAt(runs: TaskRuns | null | undefined, at: string | null): number {
	if (!runs || !at) return runs?.current ?? 1;
	const t = Date.parse(at);
	let n = 1;
	for (const r of runs.runs) if (r.startedAt && Date.parse(r.startedAt) <= t) n = r.n;
	return n;
}

/**
 * One run's times in a line for the switcher (its outcome sits beside it),
 * e.g. "Built in 1h 5m · 3 changes requested" or "12 min so far".
 */
export function runLine(runs: TaskRuns, r: TaskRun, now: number): string {
	const start = r.startedAt ? Date.parse(r.startedAt) : null;
	const next = runs.runs.find((x) => x.n === r.n + 1);
	const parts: string[] = [];
	if (r.readyAt && start !== null) {
		parts.push(`built in ${duration((Date.parse(r.readyAt) - start) / 1000)}`);
	} else if (start !== null && r.outcome === 'building') {
		parts.push(`${duration((now - start) / 1000)} so far`);
	}
	if (r.outcome === 'changes-requested' && next?.changes.length) {
		const n = next.changes.length;
		parts.push(`${n} ${plural(n, 'change', 'changes')} requested`);
	}
	const line = parts.join(' · ');
	return line ? line[0].toUpperCase() + line.slice(1) : 'No times recorded';
}
