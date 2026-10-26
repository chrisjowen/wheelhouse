import { getRuntime, type Runtime } from './runtime';
import { GAPS } from './firstmate/model';
import type { BuildContext } from './buildlog/reader';
import type { DocView } from '../buildlog';
import type { DecisionView, TaskDetail, TaskEvidence, TaskSummary, TimelineEntry } from '../types';

const MAX_TIMELINE = 120;

export type DetailResult =
	{ ok: true; detail: TaskDetail } | { ok: false; status: 404 | 503; message: string };

/** A task with its evidence and fleet-ledger history (task pages). */
export async function taskDetail(id: string): Promise<DetailResult> {
	const runtime = await getRuntime();
	if (!runtime.configured) return { ok: false, status: 503, message: runtime.error };
	const task = runtime.collector.getFleet().tasks.find((t) => t.id === id);
	if (!task) return { ok: false, status: 404, message: `There is no task called ${id}.` };

	const row = runtime.collector.row(task.id);
	const ledger = runtime.collector.ledgerTask(task.id);
	const ledgerState = runtime.collector.ledgerState();
	const evidence = await runtime.evidence.evidence(task, row, ledger?.runIds ?? []);

	const at = (ts: number) => new Date(ts * 1000).toISOString();
	let timeline: TaskDetail['timeline'];
	if (ledger) {
		const entries: TimelineEntry[] = [];
		if (ledger.dispatched) {
			entries.push({
				at: at(ledger.dispatched.ts),
				kind: 'dispatched',
				state: null,
				text: 'Dispatched'
			});
		}
		for (const s of ledger.statuses) {
			entries.push({ at: at(s.ts), kind: 'status', state: s.state, text: s.text });
		}
		if (ledger.prReady) {
			entries.push({
				at: at(ledger.prReady.ts),
				kind: 'pr-ready',
				state: null,
				text: ledger.prReady.pr
			});
		}
		if (ledger.merged) {
			entries.push({
				at: at(ledger.merged.ts),
				kind: 'merged',
				state: null,
				text: ledger.merged.via === 'local' ? 'Landed locally' : (ledger.merged.pr ?? 'Merged')
			});
		}
		if (ledger.cleanedUpAt !== null) {
			entries.push({
				at: at(ledger.cleanedUpAt),
				kind: 'cleaned-up',
				state: null,
				text: 'Cleaned up'
			});
		}
		entries.sort((a, b) => a.at.localeCompare(b.at));
		timeline = {
			available: true,
			source: 'Firstmate’s fleet activity ledger (history, not current state)',
			observedAt: null,
			value: entries.slice(-MAX_TIMELINE)
		};
	} else {
		timeline = {
			available: false,
			reason: ledgerState.available
				? 'The fleet ledger has no history for this task (it may predate the ledger).'
				: (ledgerState.reason ?? 'Firstmate’s fleet activity ledger is not available.')
		};
	}

	const gaps: string[] = [GAPS.decisionOptions];
	// A project whose passage declares a live step observes its own deployments.
	if (task.passage.live === null) gaps.unshift(GAPS.deployment);
	if (!task.preview) gaps.push(GAPS.preview);
	if (!row && task.status === 'landed') gaps.push(GAPS.landedHistory);
	if (task.worker && !task.worker.model) gaps.push(GAPS.modelDefault);

	const decided = runtime.insights.decisions(task.id);
	const build = await runtime.build.insight(buildContext(runtime, task, evidence.files, decided));

	const detail: TaskDetail = {
		schema: 'wheelhouse-task.v1',
		task,
		evidence,
		timeline,
		gaps,
		time: runtime.insights.split(task.id),
		decided,
		build
	};
	return { ok: true, detail };
}

type Configured = Extract<Runtime, { configured: true }>;

function buildContext(
	runtime: Configured,
	task: TaskSummary,
	files: TaskEvidence['files'],
	decided: DecisionView[]
): BuildContext {
	const row = runtime.collector.row(task.id);
	const project = runtime.collector.getFleet().projects.find((p) => p.id === task.projectId);
	return {
		task,
		ledger: runtime.collector.ledgerTask(task.id),
		worktree: row?.worktree.present ? row.worktree.path : null,
		projectDir: row?.project ?? project?.path ?? null,
		runs: runtime.insights.runsFor(task.id),
		decided,
		captain: (runtime.messenger?.view().messages ?? []).filter((m) => m.taskId === task.id),
		files
	};
}

/** One doc or decision record the task's session read or changed, for the reader page. */
export async function taskDoc(
	id: string,
	file: string
): Promise<
	{ ok: true; task: TaskSummary; doc: DocView } | { ok: false; status: 404 | 503; message: string }
> {
	const runtime = await getRuntime();
	if (!runtime.configured) return { ok: false, status: 503, message: runtime.error };
	const task = runtime.collector.getFleet().tasks.find((t) => t.id === id);
	if (!task) return { ok: false, status: 404, message: `There is no task called ${id}.` };
	const row = runtime.collector.row(task.id);
	const files: TaskEvidence['files'] = row?.worktree.present
		? await runtime.evidence.diff(row.worktree.path)
		: { available: false, reason: 'The task’s worktree is no longer there.' };
	const ctx = buildContext(runtime, task, files, runtime.insights.decisions(task.id));
	return { ok: true, task, doc: await runtime.build.doc(ctx, file) };
}
