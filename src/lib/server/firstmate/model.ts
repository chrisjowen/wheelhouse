import path from 'node:path';
import type { BacklogRecord, FleetSnapshot, SnapshotTask } from './contracts';
import type { CiChecks } from './evidence';
import type { LedgerTask } from './ledger';
import { stagesFor as defaultStagesFor, type StageFacts, type StageModel } from './stages';
import type { Attention, Project, TaskStatus, TaskSummary, Thumb, Track } from '../../types';

/**
 * Every decision about where a piece of Wheelhouse task data comes from lives
 * in this module (with passage stages behind the StageModel interface in
 * stages.ts): how a task's plain status, "needs you" ask, worker identity and
 * history are derived from Firstmate's fleet snapshot and fleet ledger, and
 * which things Firstmate does not record yet (GAPS). The follow-up data review
 * can change a source here without touching the UI or the collector.
 *
 * Rules that matter:
 * - Current state comes only from the snapshot's `current_state` (Firstmate's
 *   crew-state read). Status-log and ledger lines are history: they can be a
 *   progress line, never the current state.
 * - "Needs you" means waiting on the captain: a live captain hold, or a ship
 *   task whose open, non-draft PR is CI-ready and awaits the captain's merge
 *   (yolo off). CI-ready is crew state done, or a worker still attached to the
 *   PR (working or paused, e.g. the no-mistakes CI monitor that runs until
 *   merge) whose CI monitor log reads green or whose latest decisive status
 *   line is `done: PR <url> checks green`. A worker's open decision goes to
 *   Firstmate first, so it is "Waiting on Firstmate".
 * - Preview URLs are shown only when a worker reported one with a
 *   `preview <url>` status line; nothing is guessed from other text.
 */

/** Things Firstmate does not expose yet, shown as honest "not available" states. */
export const GAPS = {
	deployment: 'Deployments: Firstmate does not record deployments, so there is no Deployed step.',
	preview: 'Preview URLs: only shown when a worker reports one with a `preview <url>` status line.',
	decisionOptions:
		'Decision options: decisions are free text, so they show as text and are answered through Firstmate.',
	landedHistory:
		'History after cleanup: Firstmate removes a task’s worker records when it is cleaned up; only the backlog row, its data folder, the PR and the fleet ledger remain.',
	modelDefault:
		'Model: Firstmate records the requested model; “default” means the harness default, and the actual model is not recorded.'
} as const;

const STATUS_LABEL: Record<TaskStatus, string> = {
	'needs-review': 'Needs your review',
	'needs-decision': 'Needs your decision',
	'with-firstmate': 'Waiting on Firstmate',
	working: 'Working',
	waiting: 'Waiting',
	blocked: 'Blocked',
	failed: 'Failed',
	lost: 'Lost contact',
	unknown: 'State unknown',
	done: 'Finished',
	queued: 'Queued',
	landed: 'Landed'
};

const PR_NUMBER = /\/pull\/(\d+)(?:[/?#]|$)/;

export function prNumber(url: string): number | null {
	const m = PR_NUMBER.exec(url);
	return m ? Number(m[1]) : null;
}

export function trackOf(kind: string | null): Track {
	return kind === 'scout' ? 'scout' : 'ship';
}

const isYoloOn = (yolo: string | null) => (yolo ?? '').toLowerCase() === 'on';
const isoSeconds = (ts: number) => new Date(ts * 1000).toISOString();

export interface ProjectRegistryEntry {
	name: string;
	description: string | null;
}

/** Parse Firstmate's data/projects.md lines: `- name [posture] - description (added …)`. */
export function parseProjectsRegistry(text: string): ProjectRegistryEntry[] {
	const out: ProjectRegistryEntry[] = [];
	for (const line of text.split('\n')) {
		const m = /^-\s+([A-Za-z0-9._-]+)(?:\s+\[[^\]]*\])?(?:\s+-\s+(.*))?$/.exec(line.trim());
		if (!m) continue;
		const description = (m[2] ?? '').replace(/\s*\(added [^)]*\)\s*$/, '').trim();
		out.push({ name: m[1], description: description || null });
	}
	return out;
}

export const UNASSIGNED = 'unassigned';

function projectIdForTask(task: SnapshotTask, fmRoot: string | null): string {
	if (task.backlog?.repo) return task.backlog.repo;
	if (task.project) {
		if (fmRoot && path.resolve(task.project) === path.resolve(fmRoot)) return 'firstmate';
		return path.basename(task.project);
	}
	return UNASSIGNED;
}

/** Review evidence for one task, gathered by the collector from the evidence reader. */
export interface ReviewSignals {
	/** How many screenshots the task has. */
	screenshots: number;
	/** What the task's no-mistakes CI monitor last logged about the PR's checks. */
	ciChecks: CiChecks;
	/** The PR is a draft (null when unknown). */
	prDraft: boolean | null;
	/** The PR's forge state, e.g. open, closed or merged (null when unknown). */
	prState: string | null;
}

export interface DeriveContext {
	registry: ProjectRegistryEntry[];
	/** Card thumbnails by task id, gathered by the evidence reader. */
	thumbs: Map<string, Thumb>;
	/** Review evidence by task id (absent: nothing gathered). */
	review?: Map<string, ReviewSignals>;
	/** Fleet ledger history by task id (empty when the ledger is off). */
	ledger: Map<string, LedgerTask>;
	/** The stage model for a project (defaults to stages.ts's choice). */
	stagesFor?: (projectId: string) => StageModel;
	/** Seconds since the epoch, for ages. */
	nowSeconds: number;
}

export function ageText(seconds: number): string {
	if (seconds < 90) return 'just now';
	const m = Math.round(seconds / 60);
	if (m < 90) return `${m} min ago`;
	const h = Math.round(m / 60);
	if (h < 36) return `${h} h ago`;
	return `${Math.round(h / 24)} days ago`;
}

/** Latest progress line from history, labelled with its age. */
function historySummary(
	task: SnapshotTask | null,
	ledger: LedgerTask | null,
	nowSeconds: number
): string | null {
	const last = ledger?.statuses.at(-1);
	if (last?.text) return `${last.text} (${ageText(Math.max(0, nowSeconds - last.ts))})`;
	const e = task?.lastEvent;
	if (!e?.note) return null;
	return e.ageSeconds === null ? e.note : `${e.note} (${ageText(e.ageSeconds)})`;
}

function worker(task: SnapshotTask | null, ledger: LedgerTask | null): TaskSummary['worker'] {
	const harness = task?.harness ?? ledger?.dispatched?.harness ?? null;
	if (!harness && !task) return null;
	return {
		harness,
		model: ledger?.dispatched?.model ?? null,
		modelKnown: ledger?.dispatched !== null && ledger?.dispatched !== undefined,
		mode: task?.mode ?? null,
		yolo: task?.yolo ?? null
	};
}

const CI_READY_NOTE = /\bPR\b.*checks green|checks green.*\bPR\b/;
/** Status verbs that say what the worker is doing; notes, pauses and resolutions do not. */
const DECISIVE = new Set(['done', 'working', 'blocked', 'failed', 'needs-decision']);

/** The latest decisive status line is a CI-ready report (`done: PR <url> checks green`). */
export function historyReportsCiReady(task: SnapshotTask, ledger: LedgerTask | null): boolean {
	const statuses = ledger?.statuses ?? [];
	for (let i = statuses.length - 1; i >= 0; i--) {
		const s = statuses[i];
		if (s.state && DECISIVE.has(s.state)) {
			return s.state === 'done' && CI_READY_NOTE.test(s.text);
		}
	}
	const e = task.lastEvent;
	return e?.state === 'done' && CI_READY_NOTE.test(e.note ?? '');
}

/**
 * The task's PR is CI-ready and waits only on a merge decision. no-mistakes
 * keeps its CI monitor running until the PR merges, so crew state can read
 * working (run-step at the ci step) or paused while the PR is already green.
 */
export function prAwaitsMerge(
	task: SnapshotTask,
	ledger: LedgerTask | null,
	signals: ReviewSignals | null
): boolean {
	const cs = task.current;
	if (!cs || signals?.prDraft === true) return false;
	if (signals?.prState && signals.prState.toLowerCase() !== 'open') return false;
	if (cs.state === 'done') return true;
	if (cs.state !== 'working' && cs.state !== 'paused') return false;
	if (task.openDecisions.some((d) => d.summary)) return false;
	const phase = runPhase(task.current);
	// A fix round is not a CI monitor waiting on merge.
	if (phase === 'fixing') return false;
	const ci = signals?.ciChecks ?? 'unknown';
	if (ci === 'not-ready') return false;
	if (ci === 'green') return true;
	// A run that crew state does not place at its ci step needs its own CI log to say green.
	return phase !== 'running' && historyReportsCiReady(task, ledger);
}

/**
 * Where a run-step crew state places its no-mistakes run: `ci` (the ci step),
 * `fixing` (a fix round), `running` (any other active step; Firstmate reads
 * the CI monitor phase as `validating (running)` too), or null when crew
 * state does not come from a run.
 */
export function runPhase(cs: SnapshotTask['current']): 'ci' | 'fixing' | 'running' | null {
	if (!cs || cs.source !== 'run-step' || cs.state === 'done') return null;
	const detail = cs.detail ?? '';
	if (/^ci running\b/.test(detail)) return 'ci';
	if (/\bfixing\b/.test(detail)) return 'fixing';
	return 'running';
}

function preview(ledger: LedgerTask | null): TaskSummary['preview'] {
	return ledger?.preview
		? { url: ledger.preview.url, reportedAt: isoSeconds(ledger.preview.ts) }
		: null;
}

/** Derive one live task (a snapshot row with worker metadata). */
export function deriveLiveTask(
	task: SnapshotTask,
	ctx: DeriveContext,
	fmRoot: string | null
): TaskSummary {
	const ledger = ctx.ledger.get(task.id) ?? null;
	const backlog = task.backlog;
	const track = trackOf(task.kind ?? backlog?.kind ?? null);
	const cs = task.current;
	const state = cs?.state ?? 'unknown';
	const prUrl = task.prUrl ?? ledger?.prReady?.pr ?? backlog?.prUrl ?? null;
	const decisions = task.openDecisions.filter((d) => d.summary);
	const captainHold = backlog?.captainActionable === true;
	const endpointGone = task.endpoint.exists === false;
	const merged = ledger?.merged != null;
	const signals = ctx.review?.get(task.id) ?? null;
	const prReady = track === 'ship' && !!prUrl && prAwaitsMerge(task, ledger, signals);

	let status: TaskStatus;
	let attention: Attention | null = null;
	let summary: string | null = null;

	if (track === 'ship' && (merged || backlog?.state === 'done')) {
		status = 'landed';
	} else if (captainHold) {
		status = 'needs-decision';
		attention = {
			kind: 'decision',
			owner: 'captain',
			text: backlog?.holdReason ?? decisions[0]?.summary ?? 'Firstmate is holding this for you.',
			url: null
		};
	} else if (prReady && prUrl && !isYoloOn(task.yolo)) {
		const n = prNumber(prUrl);
		status = 'needs-review';
		attention = {
			kind: 'review',
			owner: 'captain',
			text: `Pull request${n ? ` #${n}` : ''} is ready for your review.`,
			url: prUrl
		};
	} else if (endpointGone && state !== 'done') {
		status = 'lost';
		summary = 'The worker’s terminal is gone, so Wheelhouse cannot see it any more.';
	} else if (state === 'blocked') {
		status = 'blocked';
		summary = decisions[0]?.summary ?? cs?.detail ?? null;
	} else if (state === 'failed') {
		status = 'failed';
		summary = cs?.detail ?? null;
	} else if (decisions.length) {
		status = 'with-firstmate';
		attention = { kind: 'decision', owner: 'firstmate', text: decisions[0].summary!, url: null };
	} else if (state === 'working') {
		status = 'working';
	} else if (state === 'parked' || state === 'paused') {
		status = 'waiting';
		summary = cs?.detail ?? null;
	} else if (state === 'done') {
		status = 'done';
	} else {
		status = 'unknown';
		summary = cs?.detail ?? 'Firstmate could not read this task’s current state.';
	}
	if (!summary && attention) summary = attention.text;
	let summaryIsHistory = false;
	if (!summary) {
		summary = historySummary(task, ledger, ctx.nowSeconds);
		summaryIsHistory = summary !== null;
	}

	const facts: StageFacts = {
		track,
		backlogState: backlog?.state ?? null,
		live: true,
		crewState: cs?.state ?? null,
		crewSource: cs?.source ?? null,
		mode: task.mode,
		yolo: task.yolo,
		prUrl,
		prReady,
		merged,
		reportPresent: task.report.present,
		captainHold
	};
	const projectId = projectIdForTask(task, fmRoot);
	const passage = (ctx.stagesFor ?? defaultStagesFor)(projectId).passage(facts);
	const outputAvailable = task.endpoint.exists === true;

	return {
		id: task.id,
		title: backlog?.title ?? task.id,
		projectId,
		kind: task.kind ?? backlog?.kind ?? null,
		track,
		status,
		statusLabel:
			status === 'done'
				? track === 'scout'
					? 'Report ready'
					: 'Finished; with Firstmate'
				: STATUS_LABEL[status],
		summary,
		summaryIsHistory,
		worker: worker(task, ledger),
		branch: task.branch,
		passage,
		attention,
		current: cs
			? {
					state: cs.state,
					source: cs.source,
					detail: cs.detail,
					observedAt: cs.observedAt,
					fresh: cs.freshness === 'fresh'
				}
			: null,
		pr: prUrl ? { url: prUrl, number: prNumber(prUrl) } : null,
		since: backlog?.since ?? null,
		completedOn: backlog?.state === 'done' ? backlog.completion.date : null,
		mergedAt: ledger?.merged ? isoSeconds(ledger.merged.ts) : null,
		preview: preview(ledger),
		blockedBy: backlog?.unresolvedBlockerIds ?? [],
		hasReport: task.report.present,
		outputAvailable,
		outputNote: outputAvailable
			? null
			: endpointGone
				? 'The worker’s terminal no longer exists.'
				: 'Firstmate did not report a terminal for this worker.',
		thumb: ctx.thumbs.get(task.id) ?? { kind: 'none' },
		screenshots: signals?.screenshots ?? 0
	};
}

/** Derive a backlog-only record (queued, landed, or in flight with no worker record). */
export function deriveBacklogTask(
	record: BacklogRecord,
	ctx: DeriveContext,
	orphan: boolean
): TaskSummary {
	const ledger = ctx.ledger.get(record.id) ?? null;
	const track = trackOf(record.kind ?? ledger?.dispatched?.kind ?? null);
	const prUrl = record.prUrl ?? ledger?.merged?.pr ?? ledger?.prReady?.pr ?? null;
	let status: TaskStatus;
	let summary: string | null = null;
	let attention: Attention | null = null;

	if (record.state === 'done') {
		status = 'landed';
		const verb = record.completion.verb || 'done';
		const when = ledger?.merged
			? ageText(Math.max(0, ctx.nowSeconds - ledger.merged.ts))
			: record.completion.date
				? `on ${record.completion.date}`
				: null;
		summary = when ? `${verb[0].toUpperCase()}${verb.slice(1)} ${when}.` : null;
	} else if (record.captainActionable) {
		status = 'needs-decision';
		attention = {
			kind: 'decision',
			owner: 'captain',
			text: record.holdReason ?? 'Firstmate is holding this for you.',
			url: null
		};
		summary = attention.text;
	} else if (orphan) {
		status = 'unknown';
		summary = 'Firstmate lists this as in flight, but has no worker record for it.';
	} else {
		status = 'queued';
		summary = record.unresolvedBlockerIds.length
			? `Waiting on ${record.unresolvedBlockerIds.join(', ')}.`
			: 'Not started yet.';
	}

	const projectId = record.repo ?? ledger?.dispatched?.project ?? UNASSIGNED;
	const passage = (ctx.stagesFor ?? defaultStagesFor)(projectId).passage({
		track,
		backlogState: record.state,
		live: false,
		crewState: null,
		crewSource: null,
		mode: null,
		yolo: null,
		prUrl,
		prReady: false,
		merged: record.state === 'done' || (ledger?.merged !== null && ledger?.merged !== undefined),
		reportPresent: false,
		captainHold: record.captainActionable
	});

	return {
		id: record.id,
		title: record.title ?? record.id,
		projectId,
		kind: record.kind,
		track,
		status,
		statusLabel: STATUS_LABEL[status],
		summary,
		summaryIsHistory: false,
		worker: worker(null, ledger),
		branch: null,
		passage,
		attention,
		current: null,
		pr: prUrl ? { url: prUrl, number: prNumber(prUrl) } : null,
		since: record.since,
		completedOn: record.state === 'done' ? record.completion.date : null,
		mergedAt: ledger?.merged ? isoSeconds(ledger.merged.ts) : null,
		preview: preview(ledger),
		blockedBy: record.unresolvedBlockerIds,
		hasReport: false,
		outputAvailable: false,
		outputNote:
			record.state === 'done'
				? 'This task has landed; its worker is gone.'
				: 'No worker is running for this task.',
		thumb: ctx.thumbs.get(record.id) ?? { kind: 'none' },
		screenshots: ctx.review?.get(record.id)?.screenshots ?? 0
	};
}

/** Backlog records shown without a live worker: queued, done, and orphaned in-flight rows. */
export function backlogOnly(snapshot: FleetSnapshot): { record: BacklogRecord; orphan: boolean }[] {
	const live = new Set(snapshot.tasks.map((t) => t.id));
	const orphans = new Set(snapshot.orphanInFlight);
	return snapshot.backlog.records
		.filter((r) => !live.has(r.id))
		.filter((r) => r.state === 'queued' || r.state === 'done' || orphans.has(r.id))
		.map((record) => ({ record, orphan: orphans.has(record.id) }));
}

/** Derive every task and project from one fleet snapshot. */
export function deriveTasks(
	snapshot: FleetSnapshot,
	ctx: DeriveContext
): { tasks: TaskSummary[]; projects: Project[] } {
	const fmRoot = snapshot.roots.fmRoot;
	const tasks: TaskSummary[] = snapshot.tasks.map((t) => deriveLiveTask(t, ctx, fmRoot));
	for (const { record, orphan } of backlogOnly(snapshot)) {
		tasks.push(deriveBacklogTask(record, ctx, orphan));
	}

	const paths = new Map<string, string>();
	for (const t of snapshot.tasks) {
		const id = projectIdForTask(t, fmRoot);
		if (t.project && !paths.has(id)) paths.set(id, t.project);
	}
	const registry = new Map(ctx.registry.map((r) => [r.name, r]));
	const ids = [...new Set(tasks.map((t) => t.projectId))];
	const projects: Project[] = ids
		.map((id) => ({
			id,
			name: id === UNASSIGNED ? 'No project' : id === 'firstmate' ? 'Firstmate' : id,
			description:
				registry.get(id)?.description ?? (id === 'firstmate' ? 'Firstmate itself' : null),
			path: paths.get(id) ?? null
		}))
		.sort((a, b) =>
			a.id === UNASSIGNED ? 1 : b.id === UNASSIGNED ? -1 : a.name.localeCompare(b.name)
		);
	return { tasks, projects };
}
