import { getRuntime } from './runtime';
import { GAPS } from './firstmate/model';
import type { TaskDetail, TimelineEntry } from '../types';

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

	const gaps: string[] = [GAPS.deployment, GAPS.decisionOptions];
	if (!task.preview) gaps.push(GAPS.preview);
	if (!row && task.status === 'landed') gaps.push(GAPS.landedHistory);
	if (task.worker && !task.worker.model) gaps.push(GAPS.modelDefault);

	const detail: TaskDetail = { schema: 'wheelhouse-task.v1', task, evidence, timeline, gaps };
	return { ok: true, detail };
}
