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

/** What a task is doing now, in plain words (never a raw status line). */
export interface Activity {
	text: string;
	/** When it was reported, or when the current validation step started (pipeline). */
	at: string | null;
	/**
	 * pipeline: the validation run's current step, from its own step logs;
	 * status: the worker's latest status line; state: Firstmate's crew-state read.
	 */
	source: 'pipeline' | 'status' | 'state';
}

/** Where an active no-mistakes validation run is, from its step logs. */
export interface Pipeline {
	/** The step key, e.g. review, test or ci. */
	step: string;
	label: string;
	/** When the current step started, when known. */
	startedAt: string | null;
	/** The fix round under way in this step, if one is. */
	round: number | null;
}

export interface TaskSummary {
	id: string;
	/** The full backlog title. */
	title: string;
	/** The title without its leading "<project>:" prefix, for cards. */
	shortTitle: string;
	projectId: string;
	kind: string | null;
	track: Track;
	status: TaskStatus;
	/** The status in plain words, e.g. "Blocked" or "Lost contact". */
	statusLabel: string;
	/** Latest available progress line in plain words, or why there is none. */
	summary: string | null;
	/** True when the summary comes from the status log (history, not current state). */
	summaryIsHistory: boolean;
	/** The raw line the summary was made from (task page "details" only). */
	summaryRaw: string | null;
	/** What the task is doing now, for the card's "Now:" line. */
	activity: Activity | null;
	/** The worker is actively busy right now (fresh crew state reads working). */
	busy: boolean;
	/** The active validation run's step, when one is running. */
	pipeline: Pipeline | null;
	/** Files changed in the task worktree, when it can be read. */
	filesChanged: number | null;
	worker: {
		harness: string | null;
		/** The worker's window name, e.g. fm-wh-plugins. */
		name: string | null;
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
	/** How many screenshots the task has (the thumb shows the latest). */
	screenshots: number;
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
	/** Sending messages to Firstmate through fm-inbox.sh. */
	messaging: Messaging;
}

export interface Messaging {
	/** Wheelhouse can send messages (the inbox contract is supported and the store is usable). */
	available: boolean;
	reason: string | null;
	/** Where Wheelhouse keeps its message request ids and receipts (outside the Firstmate home). */
	store: string | null;
}

/**
 * Whether Firstmate has the message, kept separate from whether it acted on it.
 *   sending            Wheelhouse is handing it to Firstmate now.
 *   delivered          saved in Firstmate's inbox and Firstmate was woken.
 *   saved-unannounced  saved, but Firstmate was not woken yet; Wheelhouse retries.
 *   uncertain          Wheelhouse could not confirm; it re-checks with the same request id.
 *   failed             Firstmate refused it and nothing was saved; retrying is safe.
 */
export type Delivery = 'sending' | 'delivered' | 'saved-unannounced' | 'uncertain' | 'failed';

export interface BridgeMessage {
	/** The stable request id (Idempotency-Key) the message was sent with. */
	requestId: string;
	/** What the captain wrote, without the task prefix. */
	text: string;
	/** The task the message is about; it still goes to Firstmate. */
	taskId: string | null;
	submittedAt: string;
	delivery: Delivery;
	/** Why delivery is not confirmed, in plain words. */
	deliveryDetail: string | null;
	/** Firstmate acknowledged (drained) the note; null until Wheelhouse has seen its receipt. */
	acknowledged: boolean | null;
	/** Firstmate's inbox note id. */
	noteId: string | null;
	/** The reply Firstmate recorded with `fm-inbox.sh reply`, as plain text. */
	reply: { body: string; at: string | null } | null;
}

export interface MessagesView {
	schema: 'wheelhouse-messages.v1';
	available: boolean;
	reason: string | null;
	/** Oldest first. */
	messages: BridgeMessage[];
	/** When Wheelhouse last read Firstmate's receipts successfully. */
	receiptsAt: string | null;
	/** Why the latest receipts read failed, if it did. */
	receiptsError: string | null;
	/** Why the latest write of Wheelhouse's message record failed, if it did. */
	storeError: string | null;
}

export type Available<T> =
	| { available: true; value: T; source: string; observedAt: string | null }
	| { available: false; reason: string };

export interface FileChange {
	path: string;
	/** The path before a rename (status 'R'). */
	oldPath?: string;
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
		/** The commit the diff is taken against (merge base of HEAD and base). */
		mergeBase: string;
		branch: string | null;
		files: FileChange[];
		/** How many files changed, before the list is cut to its first entries. */
		total: number;
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

/** One file's unified diff from the task worktree (read-only, bounded). */
export type FileDiff = Available<{
	path: string;
	base: string;
	/** Unified diff lines, without the git headers. */
	lines: string[];
	truncated: boolean;
}>;

export interface TaskOutput {
	available: boolean;
	reason: string | null;
	lines: string[];
	capturedAt: string | null;
	requested: number;
}
