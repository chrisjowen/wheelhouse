/**
 * The Wheelhouse API contract, shared by the server and the UI.
 */

export type Track = 'ship' | 'scout';

/**
 * Passage step keys are open strings so stage definitions can grow per project;
 * KNOWN_STEPS (server/firstmate/stages.ts) lists the built-in ones.
 */
export type StageKey = string;

/**
 * One plain status per task, in the captain's terms.
 * `with-firstmate` ("Waiting on Firstmate"): a worker raised a decision that
 * Firstmate is handling; it has not been put to the captain, so it is visible
 * but not counted under "Needs you".
 */
export type TaskStatus =
	| 'needs-review'
	| 'needs-decision'
	| 'with-firstmate'
	| 'working'
	| 'waiting'
	| 'blocked'
	| 'failed'
	| 'lost'
	| 'unknown'
	| 'done'
	| 'queued'
	| 'landed';

export type StepState = 'done' | 'current' | 'upcoming' | 'skipped';

export interface PassageStep {
	key: StageKey;
	label: string;
	short: string;
	state: StepState;
	/** Why a step is skipped, or a note about what the step shows. */
	note: string | null;
	/** Chart column this step lines up with (a step key; scout steps align with ship steps). */
	column: string;
	/** Evidence blocks to show under this step, in order (ids of TaskEvidence blocks). */
	evidence: string[];
}

export interface Passage {
	track: Track;
	steps: PassageStep[];
	/** Index into steps of the current step. */
	current: number;
	/** What the current step was derived from, in plain words. */
	basis: string;
}

export interface Attention {
	kind: 'review' | 'decision';
	/** captain: waiting on the captain; firstmate: open with Firstmate. */
	owner: 'captain' | 'firstmate';
	text: string;
	url: string | null;
}

/** Card thumbnail: the latest screenshot, else a picture of the diff. */
export type Thumb =
	| { kind: 'screenshot'; url: string; name: string }
	| {
			kind: 'diff';
			files: { path: string; additions: number; deletions: number }[];
			totalFiles: number;
	  }
	| { kind: 'none' };

export interface TaskSummary {
	id: string;
	title: string;
	projectId: string;
	kind: string | null;
	track: Track;
	status: TaskStatus;
	/** The status in plain words, e.g. "Blocked" or "Lost contact". */
	statusLabel: string;
	/** Latest available progress line, or why there is none. */
	summary: string | null;
	/** True when the summary comes from the status log (history, not current state). */
	summaryIsHistory: boolean;
	worker: {
		harness: string | null;
		/** Requested model; null means the harness default. */
		model: string | null;
		modelKnown: boolean;
		mode: string | null;
		yolo: string | null;
	} | null;
	branch: string | null;
	passage: Passage;
	attention: Attention | null;
	/** Current state as Firstmate's crew-state read reports it. */
	current: {
		state: string;
		source: string | null;
		detail: string | null;
		observedAt: string | null;
		fresh: boolean;
	} | null;
	pr: { url: string; number: number | null } | null;
	since: string | null;
	/** Day the backlog marks it done. */
	completedOn: string | null;
	/** Exact merge time from the fleet ledger, when recorded. */
	mergedAt: string | null;
	/** A preview URL the worker reported (`preview <url>` status line). */
	preview: { url: string; reportedAt: string } | null;
	blockedBy: string[];
	hasReport: boolean;
	/** The worker's terminal can be sampled (a live endpoint exists). */
	outputAvailable: boolean;
	outputNote: string | null;
	thumb: Thumb;
}

export interface Project {
	id: string;
	name: string;
	description: string | null;
	path: string | null;
}

export interface FleetView {
	schema: 'wheelhouse-fleet.v1';
	/** When Firstmate generated the snapshot behind this view. */
	generatedAt: string | null;
	/** When Wheelhouse last read Firstmate successfully. */
	collectedAt: string | null;
	stale: boolean;
	staleReason: string | null;
	projects: Project[];
	tasks: TaskSummary[];
}

export interface Supervisor {
	available: boolean;
	/** Firstmate is running and reading its inbox. */
	onWatch: boolean | null;
	reason: string | null;
	observedAt: string | null;
	posture: string | null;
}

export interface Health {
	schema: 'wheelhouse-health.v1';
	version: string;
	configured: boolean;
	firstmate: {
		dir: string | null;
		home: string | null;
		version: string | null;
		compatible: boolean;
		problems: string[];
		scripts: { name: string; purpose: string; ok: boolean; problem: string | null }[];
	};
	supervisor: Supervisor;
	collector: {
		/** Readiness and ledger cadence. */
		intervalMs: number;
		/** Current (adaptive) fleet snapshot cadence. */
		snapshotIntervalMs: number;
		lastAttemptAt: string | null;
		lastSuccessAt: string | null;
		consecutiveFailures: number;
		lastError: string | null;
	};
	/** Firstmate's fleet activity ledger (history that survives cleanup). */
	ledger: { available: boolean; reason: string | null };
}

export type Available<T> =
	| { available: true; value: T; source: string; observedAt: string | null }
	| { available: false; reason: string };

export interface FileChange {
	path: string;
	status: string;
	additions: number | null;
	deletions: number | null;
}

export interface Check {
	name: string;
	state: 'pass' | 'fail' | 'running' | 'pending' | 'skipped' | 'unknown';
}

export interface TaskEvidence {
	files: Available<{
		base: string;
		branch: string | null;
		files: FileChange[];
		truncated: boolean;
	}>;
	pr: Available<{
		url: string;
		number: number | null;
		state: string | null;
		draft: boolean | null;
		reviewDecision: string | null;
		checks: Check[];
	}>;
	report: Available<{ path: string; excerpt: string }>;
	screenshots: Available<{ name: string; url: string; modifiedAt: string }[]>;
	preview: Available<{ url: string }>;
	decisions: { key: string | null; text: string }[];
	/** The local validation step, as Firstmate's crew-state read reports it. */
	validation: Available<{ detail: string }>;
}

export interface TimelineEntry {
	at: string;
	kind: 'dispatched' | 'status' | 'pr-ready' | 'merged' | 'cleaned-up';
	state: string | null;
	text: string;
}

export interface TaskDetail {
	schema: 'wheelhouse-task.v1';
	task: TaskSummary;
	evidence: TaskEvidence;
	/** History from the fleet ledger (never current state). */
	timeline: Available<TimelineEntry[]>;
	/** Things Firstmate does not record yet, in plain words. */
	gaps: string[];
}

export interface TaskOutput {
	available: boolean;
	reason: string | null;
	lines: string[];
	capturedAt: string | null;
	requested: number;
}
