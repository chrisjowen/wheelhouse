/**
 * The Wheelhouse API contract, shared by the server and the UI.
 */

import type { BuildHint, BuildInsight } from './buildlog';

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
	/**
	 * Evidence blocks to show under this step, in order: ids of TaskEvidence
	 * blocks, or `check:<id>` for one of the passage's declared checks.
	 */
	evidence: string[];
	/** The step is current because its failure condition holds (e.g. a failed deploy). */
	failed: boolean;
}

/**
 * One declared check's latest result for a task.
 *   observed  the check reported an outcome
 *   unknown   the check ran but could not tell (an error or a timeout)
 *   waiting   not run yet, or waiting for something it needs (e.g. a merge commit)
 *   off       not enabled: the captain has not enabled this project's passage checks
 *   gave-up   no longer checked: its step's give_up_after passed
 */
export interface PassageCheck {
	id: string;
	label: string;
	type: string;
	state: 'observed' | 'unknown' | 'waiting' | 'off' | 'gave-up';
	/** The outcome observed, e.g. success or included. */
	outcome: string | null;
	/** What it found, in plain words. */
	summary: string;
	/** A link it found (a deployment, release or run), http(s) only. */
	url: string | null;
	observedAt: string | null;
	/** A command check: exactly what it runs, as a command line. */
	command?: string | null;
	/** A command check: the end of its last run's output. */
	output?: string | null;
}

export interface Passage {
	track: Track;
	steps: PassageStep[];
	/** Index into steps of the current step. */
	current: number;
	/** What the current step was derived from, in plain words. */
	basis: string;
	/** A project or captain passage file shaped this passage. */
	custom: boolean;
	/**
	 * At or past the passage's declared live step (`headline.live`); null when
	 * the project declares none, so "N live" counts only where it means something.
	 */
	live: boolean | null;
	/** The current step's primary link (a declared check's URL), if any. */
	link: { label: string; url: string } | null;
	/** The passage's declared checks and their results for this task. */
	checks: PassageCheck[];
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

/**
 * One step of a validation run, for the checks strip and timeline.
 *   done      finished (it may have found and fixed things on the way)
 *   running   doing its first pass now
 *   fixing    applying fixes for what it found
 *   waiting   stopped at a gate until Firstmate answers
 *   failed    failed, or found problems it could not get past
 *   skipped   not run for this change
 *   upcoming  not reached yet
 */
export type CheckStepState =
	'done' | 'running' | 'fixing' | 'waiting' | 'failed' | 'skipped' | 'upcoming';

export interface PipelineStep {
	/** The no-mistakes step key (never shown). */
	key: string;
	label: string;
	state: CheckStepState;
	/** Findings this step raised. */
	findings: number;
	/** Fixes this step committed, from its step log (null when unread). */
	fixes: number | null;
	/** How long the step took, or has taken so far. */
	durationMs: number | null;
}

/**
 * Where a no-mistakes validation run is: its current step from no-mistakes'
 * own status read (else its newest step log), and, when that read worked,
 * every step with what it found.
 */
export interface Pipeline {
	/** The step key, e.g. review, test or ci. */
	step: string;
	label: string;
	/** When the current step started, when known. */
	startedAt: string | null;
	/** The fix round under way in this step, if one is. */
	round: number | null;
	/** Every step of the run, in order; empty when only the step logs could be read. */
	steps: PipelineStep[];
	/**
	 * running   the run is still going (including a CI monitor waiting on merge)
	 * passed / failed / cancelled   it has ended
	 */
	outcome: 'running' | 'passed' | 'failed' | 'cancelled';
	/** The run is stopped at a gate: how many findings it holds, how many are questions, and since when. */
	gate: { findings: number; questions: number; since: string | null } | null;
	/** Questions this run held were answered (the current fix round follows an answer). */
	answered: boolean;
	/** When the current fix round started, when known. */
	roundStartedAt: string | null;
	/** The pull request's CI as the run's CI monitor last logged it (null before CI). */
	ci: 'pending' | 'green' | 'red' | null;
	/** When this was read. */
	observedAt: string | null;
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
	/** Changes were requested after the PR was reported ready, and a new run is under way: the worker's turn. */
	addressingReview?: boolean;
	/** The task's runs, once its pull request was first reported ready (null before that). */
	runs?: TaskRuns | null;
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
	/** The newest few screenshots, for the card's thumbnails (the task page lists them all). */
	shots: { name: string; url: string }[];
	/** Rough work time left before it is ready for the captain's review (work under way only). */
	eta?: WorkEta | null;
	/** Questions raised about it and docs it touches, for the card's hint. */
	build?: BuildHint | null;
}

/**
 * One change the captain asked for on a task's pull request.
 *   github      a review, a review thread (with its file and line) or a PR comment
 *   wheelhouse  preview feedback, a change asked from the PR review, or a Decisions "Fix"
 */
export interface ChangeRequest {
	id: string;
	source: 'github' | 'wheelhouse';
	kind: 'review' | 'thread' | 'comment' | 'preview' | 'pr-review' | 'decision';
	author: string | null;
	/** What was asked, as written (trimmed to a bounded length). */
	text: string;
	at: string;
	/** Where it is on GitHub (http(s) only), when it is there. */
	url: string | null;
	/** The file and line a review thread or PR review note is on. */
	where: { path: string; line: number | null } | null;
	/**
	 * open: still to do; resolved: its thread is resolved on GitHub;
	 * addressed: the worker reported the pull request ready again after it.
	 */
	state: 'open' | 'resolved' | 'addressed';
}

/**
 * One build of a task. Run 1 builds it up to its first ready report; every
 * time changes are requested after a ready report, a new run builds, checks
 * and reports the pull request ready again.
 *   building           under way (for a later run: the worker's turn)
 *   ready              reported ready; waiting on the captain's review
 *   changes-requested  the captain asked for changes, so the next run took over
 *   landed / closed    the pull request merged, or was closed
 */
export interface TaskRun {
	n: number;
	startedAt: string | null;
	/** When this run's pull request was reported ready (null while it is being built). */
	readyAt: string | null;
	/** When changes were requested on it and the next run started (null for the current run). */
	endedAt: string | null;
	outcome: 'building' | 'ready' | 'changes-requested' | 'landed' | 'closed';
	/** Why the run started, in plain words (null for run 1). */
	basis: string | null;
	/** The changes that started this run, and any asked while it was being built, oldest first. */
	changes: ChangeRequest[];
}

export interface TaskRuns {
	/** The current run's number. */
	current: number;
	/** A later run is under way: changes were requested and it is the worker's turn. */
	reworking: boolean;
	runs: TaskRun[];
}

export interface Project {
	id: string;
	name: string;
	description: string | null;
	/** The registry's delivery posture as written, e.g. `no-mistakes-prod-only +yolo` (null when none). */
	posture: string | null;
	/** Listed in Firstmate's project registry. */
	registered: boolean;
	path: string | null;
	/** How the project's passage is defined (null until Wheelhouse has looked). */
	passage: ProjectPassageSummary | null;
}

export interface ProjectPassageSummary {
	/** A project or captain passage file is in use. */
	custom: boolean;
	/** Validation and read problems across its passage files. */
	problems: number;
	/** The project file declares network checks the captain has not enabled. */
	needsConsent: boolean;
}

export type PassageOrigin = 'builtin' | 'project' | 'captain';

/** One passage file a project's passage is layered from. */
export interface PassageSource {
	kind: 'project' | 'captain';
	/** Where it is read from, in plain words. */
	location: string;
	/**
	 * absent      no such file
	 * applied     read, valid and layered in
	 * invalid     read, but left out because of the errors listed
	 * unreadable  could not be read
	 */
	state: 'absent' | 'applied' | 'invalid' | 'unreadable';
	/** sha256 of the file. */
	digest: string | null;
	errors: string[];
	/** Project file: an edited version is saved in the clone's working tree but not on the default branch. */
	pending?: boolean;
}

export interface PassageStepDef {
	id: string;
	label: string;
	origin: PassageOrigin;
	/** Layers that restyled a step declared below them. */
	changedBy: PassageOrigin[];
	/** When it is reached, skipped and failed, in plain words. */
	reachedWhen: string | null;
	skipWhen: string | null;
	failedWhen: string | null;
	/** The same rules as written in the passage file. */
	rules: { reached: string | null; skipped: string | null; failed: string | null };
	evidence: string[];
	/** What it shows, by name. */
	evidenceWords: string[];
	primaryLink: string | null;
	giveUpAfter: string | null;
	note: string | null;
}

export interface PassageCheckDef {
	id: string;
	label: string;
	type: string;
	origin: PassageOrigin;
	/** Its parameters, in plain words. */
	params: string;
	interval: string;
	/** It reaches the network (GitHub, npm or an HTTP URL). */
	network: boolean;
	/** It runs: not a project-file network check or a command check waiting for the captain's consent. */
	enabled: boolean;
	/** It runs a program on this machine (a command check). */
	command: boolean;
}

/** One command check, exactly as it will run. */
export interface PassageCommand {
	id: string;
	label: string;
	origin: PassageOrigin;
	/** The program and its arguments. */
	run: string[];
	/** The same, as one command line for reading. */
	line: string;
	/** The folder, relative to the project clone ('.' for its top). */
	cwd: string;
	timeout: string;
	/** Environment variables passed through besides the basic ones. */
	env: string[];
	/** The commit it waits for, if any. */
	ref: string | null;
	/** When it may run, in words (null: whenever a task can use it). */
	when: string | null;
	interval: string;
}

export interface ProjectPassage {
	schema: 'wheelhouse-passage.v1';
	projectId: string;
	sources: PassageSource[];
	/** Why a source could not be looked at (no clone, no captain config). */
	notes: string[];
	passages: {
		track: Track;
		custom: boolean;
		steps: PassageStepDef[];
		checks: PassageCheckDef[];
		/** The step tasks count toward "N live" at, if declared. */
		live: string | null;
	}[];
	/** The captain's consent to the project file's network checks. */
	consent: {
		/** The project file declares network checks. */
		needed: boolean;
		enabled: boolean;
		/** The digest that would be enabled (the file as read now). */
		digest: string | null;
		enabledAt: string | null;
		/** Why consent cannot be recorded, if it cannot. */
		unavailable: string | null;
	};
	/** The captain's permission to run the passage's command checks. */
	commands: {
		list: PassageCommand[];
		enabled: boolean;
		/** A digest of exactly what the commands run; allowing it allows only this. */
		digest: string | null;
		enabledAt: string | null;
		/** Environment every command gets besides its own list. */
		baseEnv: string[];
	};
	readAt: string | null;
}

/** The steps and checks below the file being edited (built-ins, and the project file under the captain's). */
export interface PassageEditorBase {
	steps: { id: string; label: string; origin: PassageOrigin }[];
	checks: { id: string; label: string; type: string; origin: PassageOrigin }[];
}

/** One passage file opened in the editor. */
export interface PassageEditorFile {
	schema: 'wheelhouse-passage-editor.v1';
	projectId: string;
	/** project: `.wheelhouse.yaml` in the project's clone; captain: the captain-owned file. */
	target: 'project' | 'captain';
	targets: Record<'project' | 'captain', { available: boolean; why: string | null }>;
	file: {
		exists: boolean;
		text: string;
		/** sha256 as loaded; saving is refused when the file changed since. */
		digest: string | null;
		location: string;
		problem: string | null;
	};
	/** The file as it is now is the one Wheelhouse applies. */
	inEffect: boolean;
	/** The branch the project file applies from (e.g. origin/main). */
	defaultRef: string | null;
	below: Record<Track, PassageEditorBase>;
}

/** An edited file's problems, and the commands it would run. */
export interface PassageDraft {
	errors: string[];
	commands: PassageCommand[];
}

/** A task an edited passage can be tested against. */
export interface PassageTestTask {
	id: string;
	title: string;
	track: Track;
	/** The step it is at now. */
	step: string | null;
}

export type PassageTestResult =
	| { ok: true; taskId: string; passage: Passage; ran: string[] }
	| { ok: false; message: string; errors: string[] };

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
	/** Passage files and their checks. */
	passages: {
		/** The captain-owned Wheelhouse config directory, if usable. */
		configDir: string | null;
		problem: string | null;
		/** Checks running right now. */
		checksRunning: number;
	};
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
	/** Where the task's time went, when its history allows it. */
	time: TimeSplit | null;
	/** Review questions Firstmate answered on the captain's behalf for this task. */
	decided: DecisionView[];
	/** The conversation, what each check found, and the docs it read or changed. */
	build: BuildInsight;
	/** Every validation run the task had, oldest first, so each of the task's runs shows its own. */
	validations: ValidationRun[];
}

/** One no-mistakes validation run, in a line. */
export interface ValidationRun {
	id: string;
	startedAt: string | null;
	outcome: Pipeline['outcome'];
	/** What it came to, in plain words (checks.ts). */
	text: string;
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

/** The Firstmate primary session the home page shows and talks to. */
export interface FirstmateSessionView {
	schema: 'wheelhouse-firstmate-session.v1';
	/**
	 * ours: running in Wheelhouse's tmux, so the composer can type into it;
	 * external: another session holds Firstmate's lock (shown read-only);
	 * starting: Wheelhouse is starting it; none: nothing is running;
	 * unavailable: Wheelhouse cannot run one here (reason says why).
	 */
	state: 'ours' | 'external' | 'starting' | 'none' | 'unavailable';
	reason: string | null;
	canSend: boolean;
	/** A command the captain can copy to attach their own terminal, when it is ours. */
	attach: string | null;
	/** Started (or would start) with --dangerously-skip-permissions. */
	skipPermissions: boolean;
	/** A menu Claude Code is waiting on in the session (its question picker, a permission prompt), read off its screen. */
	picker: Picker | null;
	/** Claude Code is working (its screen offers "esc to interrupt"); only known for Wheelhouse's own session. */
	busy: boolean;
}

/** A numbered menu on the Firstmate session's screen (see server/sessions/picker.ts). */
export interface Picker {
	/** The question or prompt above the options. */
	title: string;
	/** The question picker's tabs, one per question, and whether each is answered. */
	tabs: { label: string; done: boolean }[];
	options: {
		n: number;
		label: string;
		description: string;
		/** Multi-choice: whether it is ticked; null for a single choice. */
		checked: boolean | null;
		/** "Type something": answered by typing, in the terminal. */
		freeText: boolean;
	}[];
	multiSelect: boolean;
	/** Rows from the cursor to a multi-choice question's Submit row, or null. */
	submitMoves: number | null;
	/** Identifies this exact menu, so a choice is never pressed into a different one. */
	signature: string;
}

/** Which transcript file the chat follows, and how Wheelhouse found it. */
export interface TranscriptSource {
	/** hook: Wheelhouse's SessionStart hook; lock: the session id beside Firstmate's lock; newest: the newest transcript for Firstmate's checkout. */
	how: 'hook' | 'lock' | 'newest';
	file: string;
	/** Earlier records were left out because the file is large. */
	truncated: boolean;
}

/** A slash command the composer offers. */
export interface SlashCommand {
	name: string;
	description: string;
	source: 'firstmate' | 'claude';
}

/* ------------------------------------------------------------------ insights */

/** Where a task's time goes. Seconds per segment. */
export type TimeSegment = 'build' | 'review' | 'deciding' | 'ci' | 'captain';

export type WorkPhase = 'building' | 'review' | 'ci' | 'captain' | 'landed' | 'done';

export interface TimeSplit {
	taskId: string;
	seconds: Record<TimeSegment, number>;
	total: number;
	/** Where the work is now. */
	phase: WorkPhase;
	/** When the current phase started (epoch seconds). */
	phaseStartedAt: number;
	/** Still running: the total grows. */
	ongoing: boolean;
	/** Work time from start to "ready for your review", once it got there. */
	readyAfter: number | null;
	/** The latest automated review's steps and how long each took. */
	reviewSteps: { step: string; label: string; seconds: number }[];
}

/** A rough estimate of the work time left before the captain's review. */
export interface WorkEta {
	/** Prototype or scouting work: no estimate, shown as time under way. */
	openEnded: boolean;
	/** Estimated minutes left (median); null when there is no estimate. */
	minutes: number | null;
	low: number | null;
	high: number | null;
	/** How many finished tasks it is based on. */
	basis: number;
	/** `project` when it uses this project's work, `kind` when work across projects. */
	scope: 'project' | 'kind' | null;
	confidence: 'guide' | 'rough' | 'early' | 'none';
	/** Similar work had finished by this point. */
	overdue: boolean;
	/** The work time so far (seconds), for open-ended work. */
	elapsed: number;
	/** Remaining phases with their usual duration (seconds). */
	ahead: {
		phase: 'building' | 'review' | 'ci';
		usual: number | null;
		current: boolean;
		spent: number;
	}[];
}

export type Verdict = 'Fix it' | 'Keep as is' | 'No change' | 'Defer' | 'Mixed' | 'Decided';

/** One review question Firstmate answered on the captain's behalf. */
export interface DecisionView {
	/** Stable anchor (not shown). */
	id: string;
	taskId: string;
	taskTitle: string;
	projectId: string | null;
	/** Where it was raised: review, test, document, lint or ci. */
	step: string;
	askedAt: string;
	decidedAt: string;
	verdict: Verdict;
	calls: {
		question: string;
		detail: string;
		file: string | null;
		serious: boolean;
		verdict: Verdict;
		reason: string;
	}[];
	/** Only the start of Firstmate's answer was kept. */
	answerCut: boolean;
	/** The work has landed, so a different call means a follow-up change. */
	landed: boolean;
}

export interface DecisionsView {
	schema: 'wheelhouse-decisions.v1';
	available: boolean;
	reason: string | null;
	decisions: DecisionView[];
}

export interface TimeView {
	schema: 'wheelhouse-time.v1';
	available: boolean;
	reason: string | null;
	tasks: (TimeSplit & {
		title: string;
		projectId: string;
		startedAt: string;
		kind: string | null;
	})[];
	/** Note on what could not be measured, in plain words. */
	notes: string[];
}

export interface AllowanceWindow {
	id: string;
	label: string;
	percentLeft: number;
	resetsAt: string | null;
	/** At the current pace it will not last until it resets. */
	atRisk: boolean;
	/** When it runs out at the pace Wheelhouse saw, if that was measured. */
	runsOutAt: string | null;
}

export interface UsageShare {
	/** firstmate | other | task:<id> */
	key: string;
	label: string;
	sub: string;
	taskId: string | null;
	fiveHour: number;
	week: number;
	/** Share of the task's use that was its automated review (0-1). */
	reviewShare: number;
}

export interface HeadroomView {
	schema: 'wheelhouse-headroom.v1';
	allowance:
		| { state: 'ok'; windows: AllowanceWindow[]; readAt: string }
		| { state: 'connect'; command: string }
		| { state: 'unavailable'; reason: string };
	usage: Available<{ shares: UsageShare[]; hourly: number[] }>;
	/** The first window that runs out before it resets, for the header. */
	atRisk: AllowanceWindow | null;
}

/** What the home page's rail shows of the insights: small, refreshed each minute. */
export interface RailInsights {
	schema: 'wheelhouse-rail-insights.v1';
	/** The latest decisions Firstmate made for the captain, newest first. */
	decisions: {
		id: string;
		taskId: string;
		projectId: string | null;
		taskTitle: string;
		verdict: Verdict;
		question: string;
		decidedAt: string;
	}[];
	/** Work started today, for "Where time went today". */
	today: { taskId: string; projectId: string; seconds: Record<TimeSegment, number> }[];
	allowance: HeadroomView['allowance'];
	atRisk: AllowanceWindow | null;
}

/* ---------------------------------------------------------------- ship's bell */

/**
 * The moments the ship's bell rings for:
 *   pr-green  a pull request is CI-ready and waits on the captain's merge
 *   question  a question is waiting on the captain (held on a task, or asked in Firstmate's session)
 *   stuck     a worker is blocked, failed, out of contact or has gone quiet
 *   landed    a merge landed
 */
export type AlertKind = 'pr-green' | 'question' | 'stuck' | 'landed';

/** What one tap on an alert does: open a page or link, or send Firstmate a captain note. */
export type AlertAction =
	| { kind: 'open'; label: string; href: string; external: boolean }
	| {
			kind: 'note';
			label: string;
			/** The note sent to Firstmate through `fm-inbox.sh note`. */
			text: string;
			/** The stable request id, so a second tap (or another tab) never sends it twice. */
			requestId: string;
			/** Shown once Firstmate has the note, e.g. "Asked Firstmate to merge". */
			sent: string;
	  };

/** One ship's bell alert, raised once by the server when a task's records first show the moment. */
export interface ShipAlert {
	/** Stable: the same moment always has the same id, so it alerts once. */
	id: string;
	kind: AlertKind;
	/** The task it is about; null for a question Firstmate asks in its own session. */
	taskId: string | null;
	projectId: string | null;
	/** The task's short title, or "Firstmate". */
	title: string;
	/** What happened, in plain words. */
	text: string;
	/** When Wheelhouse saw it. */
	at: string;
	/** Waiting on the captain: the toast stays until it is dismissed or the moment passes. */
	captain: boolean;
	/** The first action is the main one. */
	actions: AlertAction[];
}
