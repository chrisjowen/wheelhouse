import path from 'node:path';
import type { BacklogRecord, FleetSnapshot, SnapshotTask } from './contracts';
import type { CiChecks } from './evidence';
import type { LedgerTask } from './ledger';
import { stagesFor as defaultStagesFor, type StageFacts, type StageModel } from './stages';
import { shortTitle } from '../../card';
import { checksLine } from '../../checks';
import { plainStatus } from '../../plain';
import type {
	Activity,
	Attention,
	Pipeline,
	Project,
	TaskStatus,
	TaskSummary,
	Thumb,
	Track
} from '../../types';

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
 * - Status lines and crew-state details reach the UI only in plain words
 *   (plain.ts); the raw line is kept in `summaryRaw` for the task page.
 */

/** Things Firstmate does not expose yet, shown as honest "not available" states. */
export const GAPS = {
	deployment:
		'Deployments: Firstmate does not record deployments, and this project’s passage declares no Deployed step (a `.wheelhouse.yaml` can add one).',
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
	/** The bracketed delivery posture as written, e.g. `no-mistakes-prod-only +yolo`. */
	posture: string | null;
}

/** Parse Firstmate's data/projects.md lines: `- name [posture] - description (added …)`. */
export function parseProjectsRegistry(text: string): ProjectRegistryEntry[] {
	const out: ProjectRegistryEntry[] = [];
	for (const line of text.split('\n')) {
		const m = /^-\s+([A-Za-z0-9._-]+)(?:\s+\[([^\]]*)\])?(?:\s+-\s+(.*))?$/.exec(line.trim());
		if (!m) continue;
		const description = (m[3] ?? '').replace(/\s*\(added [^)]*\)\s*$/, '').trim();
		out.push({ name: m[1], description: description || null, posture: m[2]?.trim() || null });
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
	/** The newest few of them, for the card's thumbnails. */
	shots?: { name: string; url: string }[];
	/** What the task's no-mistakes CI monitor last logged about the PR's checks. */
	ciChecks: CiChecks;
	/** The PR is a draft (null when unknown). */
	prDraft: boolean | null;
	/** The PR's forge state, e.g. open, closed or merged (null when unknown). */
	prState: string | null;
	/**
	 * The PR got review feedback or new commits after Firstmate reported it
	 * ready, and no newer ready report for a newer head has followed: the
	 * worker is addressing the captain's review (see addressingReview).
	 */
	addressing?: boolean;
}

/** Review feedback and the head of a pull request, as read from GitHub (times in epoch seconds). */
export interface PrFeedback {
	head: { sha: string; at: number | null } | null;
	/** Submitted reviews: state (APPROVED, CHANGES_REQUESTED, COMMENTED, DISMISSED), when, and the commit reviewed. */
	reviews: { state: string; at: number; commitId: string | null }[];
	/** Review (diff) comments: when, and the commit they were left on. */
	comments: { at: number; commitId: string | null }[];
}

/**
 * Whether the captain's review is being addressed rather than awaited: after
 * the PR was reported ready (`readyAt`, the ledger's latest pr_ready), it got
 * review comments or a changes-requested (or commented) review, or new commits.
 * A newer ready report clears that only when it is for a newer head: the PR's
 * head must have moved past the commit the latest feedback was left on.
 * Approvals and dismissed reviews are not feedback to address.
 */
export function addressingReview(readyAt: number | null, f: PrFeedback | null): boolean {
	if (readyAt === null || !f) return false;
	const feedback = [
		...f.reviews
			.filter((r) => r.state === 'CHANGES_REQUESTED' || r.state === 'COMMENTED')
			.map((r) => ({ at: r.at, commitId: r.commitId })),
		...f.comments
	].sort((a, b) => a.at - b.at);
	const last = feedback[feedback.length - 1] ?? null;
	if (last && last.at > readyAt) return true;
	if (f.head?.at != null && f.head.at > readyAt) return true;
	if (last && f.head && last.commitId === f.head.sha) return true;
	return false;
}

/** Live progress for one task, gathered by the collector. */
export interface LiveSignals {
	/** The active validation run's current step (from its step logs). */
	pipeline: Pipeline | null;
	/** Files changed in the task worktree. */
	filesChanged: number | null;
	/** Docs and decision records the task's session referenced (read or changed), and how many it changed. */
	docs?: { referenced: number; changed: number } | null;
}

export interface DeriveContext {
	registry: ProjectRegistryEntry[];
	/** Card thumbnails by task id, gathered by the evidence reader. */
	thumbs: Map<string, Thumb>;
	/** Review evidence by task id (absent: nothing gathered). */
	review?: Map<string, ReviewSignals>;
	/** Live progress by task id (absent: nothing gathered). */
	live?: Map<string, LiveSignals>;
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

/** The worker's latest status line (ledger first, else the snapshot's last event). */
function latestStatus(
	task: SnapshotTask | null,
	ledger: LedgerTask | null,
	nowSeconds: number
): { state: string | null; text: string; ageSeconds: number | null } | null {
	const last = ledger?.statuses.at(-1);
	if (last?.text) {
		return { state: last.state, text: last.text, ageSeconds: Math.max(0, nowSeconds - last.ts) };
	}
	const e = task?.lastEvent;
	if (!e?.note) return null;
	return { state: e.state || null, text: e.note, ageSeconds: e.ageSeconds };
}

/** Latest progress line from history in plain words, labelled with its age. */
function historySummary(
	task: SnapshotTask | null,
	ledger: LedgerTask | null,
	nowSeconds: number
): { text: string; raw: string } | null {
	const last = latestStatus(task, ledger, nowSeconds);
	if (!last) return null;
	const text = plainStatus(last.state, last.text);
	return {
		text: last.ageSeconds === null ? text : `${text} (${ageText(last.ageSeconds)})`,
		raw: last.text.trim()
	};
}

/** The worker's window name from its endpoint target (`<session>:<window>`). */
const workerWindow = (target: string | null) => target?.split(':').pop()?.trim() || null;

function worker(task: SnapshotTask | null, ledger: LedgerTask | null): TaskSummary['worker'] {
	const harness = task?.harness ?? ledger?.dispatched?.harness ?? null;
	if (!harness && !task) return null;
	return {
		harness,
		name: workerWindow(task?.endpoint.target ?? null),
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

const STEP_FIX: Record<string, string> = {
	review: 'fixing review findings',
	test: 'fixing test failures',
	lint: 'fixing lint findings',
	document: 'fixing documentation findings'
};

/** The validation run's step in plain words, e.g. "Validating: fixing review findings (round 2)". */
export function pipelineText(p: Pipeline): string {
	if (p.step === 'ci') return 'Validating: waiting for CI checks';
	if (p.round !== null) {
		return `Validating: ${STEP_FIX[p.step] ?? `fixing ${p.label.toLowerCase()} findings`} (round ${p.round})`;
	}
	return `Validating: ${p.label.toLowerCase()} step`;
}

/**
 * What a live task is doing now: the validation run in plain words when
 * no-mistakes reported its steps, else the run's step while one runs, else
 * what crew state reads from a run (parked at a gate, CI), else the
 * worker's latest status line, else crew state. Always plain words.
 */
export function activityFor(
	task: SnapshotTask,
	status: TaskStatus,
	summary: string | null,
	ledger: LedgerTask | null,
	pipeline: Pipeline | null,
	nowSeconds: number
): Activity | null {
	const cs = task.current;
	const observedAt = cs?.observedAt ?? null;
	if (status === 'lost' || status === 'unknown') {
		return summary ? { text: summary, at: observedAt, source: 'state' } : null;
	}
	// A run whose steps no-mistakes reported reads the same on every surface (checks.ts).
	if (pipeline?.steps.length && cs?.source === 'run-step') {
		return { text: checksLine(pipeline, null), at: pipeline.startedAt, source: 'pipeline' };
	}
	if (pipeline && cs?.state === 'working' && runPhase(cs) !== null) {
		return { text: pipelineText(pipeline), at: pipeline.startedAt, source: 'pipeline' };
	}
	if (cs?.source === 'run-step' && cs.detail) {
		return { text: plainStatus(cs.state, cs.detail), at: observedAt, source: 'state' };
	}
	const last = latestStatus(task, ledger, nowSeconds);
	if (last) {
		return {
			text: plainStatus(last.state, last.text),
			at: last.ageSeconds === null ? null : isoSeconds(nowSeconds - last.ageSeconds),
			source: 'status'
		};
	}
	return cs?.detail
		? { text: plainStatus(cs.state, cs.detail), at: observedAt, source: 'state' }
		: null;
}

/** When a task landed (epoch ms): the ledger's merge time, else the end of its backlog completion day. */
function landedAt(ledger: LedgerTask | null, completedOn: string | null): number | null {
	if (ledger?.merged) return ledger.merged.ts * 1000;
	if (!completedOn) return null;
	const d = Date.parse(`${completedOn}T23:59:59`);
	return Number.isNaN(d) ? null : d;
}

function previewFact(ledger: LedgerTask | null): StageFacts['preview'] {
	return ledger?.preview ? { url: ledger.preview.url, at: isoSeconds(ledger.preview.ts) } : null;
}

function preview(ledger: LedgerTask | null): TaskSummary['preview'] {
	return ledger?.preview
		? { url: ledger.preview.url, reportedAt: isoSeconds(ledger.preview.ts) }
		: null;
}

/** What a task whose PR is being reworked after the captain's review is doing. */
export const ADDRESSING = 'Addressing your review';

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
	const awaits = track === 'ship' && !!prUrl && prAwaitsMerge(task, ledger, signals);
	// Reworking after the captain's review is work in play, not the captain's turn.
	const addressing = awaits && signals?.addressing === true;
	const prReady = awaits && !addressing;

	let status: TaskStatus;
	let attention: Attention | null = null;
	let summary: string | null = null;
	let summaryRaw: string | null = null;
	const fromState = (verb: string, raw: string | null | undefined) => {
		summaryRaw = raw ?? null;
		return raw ? plainStatus(verb, raw) : null;
	};

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
	} else if (addressing) {
		status = 'working';
		summary = ADDRESSING;
	} else if (endpointGone && state !== 'done') {
		status = 'lost';
		summary = 'The worker’s terminal is gone, so Wheelhouse cannot see it any more.';
	} else if (state === 'blocked') {
		status = 'blocked';
		summary = fromState('blocked', decisions[0]?.summary ?? cs?.detail);
	} else if (state === 'failed') {
		status = 'failed';
		summary = fromState('failed', cs?.detail);
	} else if (decisions.length) {
		status = 'with-firstmate';
		summaryRaw = decisions[0].summary!;
		attention = {
			kind: 'decision',
			owner: 'firstmate',
			text: plainStatus(decisions[0].verb ?? 'needs-decision', decisions[0].summary),
			url: null
		};
	} else if (state === 'working') {
		status = 'working';
	} else if (state === 'parked' || state === 'paused') {
		status = 'waiting';
		summary = fromState(state, cs?.detail);
	} else if (state === 'done') {
		status = 'done';
	} else {
		status = 'unknown';
		summary =
			fromState('unknown', cs?.detail) ?? 'Firstmate could not read this task’s current state.';
	}
	if (!summary && attention) summary = attention.text;
	let summaryIsHistory = false;
	if (!summary) {
		const h = historySummary(task, ledger, ctx.nowSeconds);
		summary = h?.text ?? null;
		summaryRaw = h?.raw ?? null;
		summaryIsHistory = h !== null;
	}
	const live = ctx.live?.get(task.id) ?? null;
	const pipeline = live?.pipeline ?? null;

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
		captainHold,
		taskId: task.id,
		landedAt: landedAt(ledger, backlog?.state === 'done' ? backlog.completion.date : null),
		preview: previewFact(ledger)
	};
	const projectId = projectIdForTask(task, fmRoot);
	const passage = (ctx.stagesFor ?? defaultStagesFor)(projectId).passage(facts);
	const outputAvailable = task.endpoint.exists === true;

	const title = backlog?.title ?? task.id;
	return {
		id: task.id,
		title,
		shortTitle: shortTitle(title, projectId),
		projectId,
		kind: task.kind ?? backlog?.kind ?? null,
		track,
		status,
		addressingReview: addressing,
		statusLabel: addressing
			? ADDRESSING
			: status === 'done'
				? track === 'scout'
					? 'Report ready'
					: 'Finished; with Firstmate'
				: STATUS_LABEL[status],
		summary,
		summaryIsHistory,
		summaryRaw,
		activity: activityFor(task, status, summary, ledger, pipeline, ctx.nowSeconds),
		busy: status === 'working' && cs?.state === 'working' && cs.freshness === 'fresh',
		pipeline,
		filesChanged: live?.filesChanged ?? null,
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
		screenshots: signals?.screenshots ?? 0,
		shots: signals?.shots ?? []
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
		captainHold: record.captainActionable,
		taskId: record.id,
		landedAt: landedAt(ledger, record.state === 'done' ? record.completion.date : null),
		preview: previewFact(ledger)
	});

	const title = record.title ?? record.id;
	return {
		id: record.id,
		title,
		shortTitle: shortTitle(title, projectId),
		projectId,
		kind: record.kind,
		track,
		status,
		statusLabel: STATUS_LABEL[status],
		summary,
		summaryIsHistory: false,
		summaryRaw: null,
		activity: null,
		busy: false,
		pipeline: null,
		filesChanged: null,
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
		screenshots: ctx.review?.get(record.id)?.screenshots ?? 0,
		shots: ctx.review?.get(record.id)?.shots ?? []
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
	// Every registered project is listed, with or without tasks; a registered project's
	// clone lives under the Firstmate home's projects/ when no task names its path.
	const ids = [...new Set([...tasks.map((t) => t.projectId), ...registry.keys()])];
	const projects: Project[] = ids
		.map((id) => ({
			id,
			name: id === UNASSIGNED ? 'No project' : id === 'firstmate' ? 'Firstmate' : id,
			description:
				registry.get(id)?.description ?? (id === 'firstmate' ? 'Firstmate itself' : null),
			posture: registry.get(id)?.posture ?? null,
			registered: registry.has(id),
			path:
				paths.get(id) ?? (registry.has(id) && fmRoot ? path.join(fmRoot, 'projects', id) : null),
			passage: null
		}))
		.sort((a, b) =>
			a.id === UNASSIGNED ? 1 : b.id === UNASSIGNED ? -1 : a.name.localeCompare(b.name)
		);
	return { tasks, projects };
}
