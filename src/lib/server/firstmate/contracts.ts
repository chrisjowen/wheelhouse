/**
 * Typed views of the Firstmate script contracts Wheelhouse reads, plus the
 * parsers that validate raw script output against them.
 *
 * Only fields Wheelhouse uses are typed; everything else in the script output is
 * ignored. Parsers are deliberately strict about the schema id and the overall
 * shape, and lenient about individual optional fields (a missing optional field
 * becomes null rather than failing the whole snapshot).
 */

export const FLEET_SNAPSHOT_SCHEMA = 'fm-fleet-snapshot.v1';
export const PRIMARY_READY_SCHEMA = 'fm-primary-ready.v1';
export const INBOX_NOTE_SCHEMA = 'fm-inbox-note.v1';
export const INBOX_RECEIPTS_SCHEMA = 'fm-inbox-receipts.v1';

export type CrewState = 'working' | 'parked' | 'done' | 'blocked' | 'paused' | 'failed' | 'unknown';

export interface CurrentState {
	state: CrewState;
	source: string | null;
	detail: string | null;
	observedAt: string | null;
	freshness: string | null;
}

export interface StatusEvent {
	state: string | null;
	note: string | null;
	ageSeconds: number | null;
}

export interface OpenDecision {
	key: string | null;
	verb: string | null;
	summary: string | null;
}

export interface BacklogRecord {
	id: string;
	state: 'in_flight' | 'queued' | 'done' | string;
	title: string | null;
	repo: string | null;
	kind: string | null;
	prUrl: string | null;
	since: string | null;
	completion: { verb: string | null; date: string | null };
	captainActionable: boolean;
	holdReason: string | null;
	holdBucket: string | null;
	unresolvedBlockerIds: string[];
	bodyExcerpt: string | null;
	order: number | null;
	structured: boolean;
}

export interface SnapshotTask {
	id: string;
	kind: string | null;
	harness: string | null;
	mode: string | null;
	yolo: string | null;
	branch: string | null;
	project: string | null;
	worktree: { path: string | null; present: boolean };
	report: { path: string | null; present: boolean };
	lastEvent: StatusEvent | null;
	current: CurrentState | null;
	/** The worker's endpoint; `target` is its backend address, e.g. `firstmate:fm-<id>`. */
	endpoint: { exists: boolean | null; freshness: string | null; target: string | null };
	prUrl: string | null;
	openDecisions: OpenDecision[];
	backlog: BacklogRecord | null;
}

export interface FleetSnapshot {
	schema: typeof FLEET_SNAPSHOT_SCHEMA;
	generated: string | null;
	fmHome: string | null;
	roots: { fmRoot: string | null; data: string | null; state: string | null };
	tasks: SnapshotTask[];
	backlog: { present: boolean; records: BacklogRecord[] };
	orphanInFlight: string[];
}

export interface PrimaryReady {
	schema: typeof PRIMARY_READY_SCHEMA;
	observedAt: string | null;
	lock: { state: string; liveHarness: boolean | null };
	wakeConsumer: { state: string; reason: string | null; beaconAgeSeconds: number | null };
	posture: string | null;
	canReceive: boolean | 'unknown';
}

/** `fm-inbox.sh note --request-id <id> --json` output. */
export interface InboxNoteResult {
	schema: typeof INBOX_NOTE_SCHEMA;
	/** created: a new note; replay: the request id already had one. */
	outcome: 'created' | 'replay';
	noteId: string;
	requestId: string | null;
	saved: boolean;
	/** Firstmate's wake was appended; null when that is unknowable (pre-marker notes). */
	announced: boolean | null;
	/** Firstmate already drained the note (it is in handled/). */
	acknowledged: boolean;
}

export interface InboxReply {
	noteId: string;
	at: string | null;
	body: string;
	/** The reply sequence, zero-padded so it compares as a string. */
	cursor: string;
}

export interface InboxReceipt {
	noteId: string;
	at: string | null;
	source: string | null;
	requestId: string | null;
	body: string;
	acknowledged: boolean;
	announced: boolean | null;
	reply: InboxReply | null;
}

/** `fm-inbox.sh receipts` output: bounded pending and handled notes, and replies. */
export interface InboxReceipts {
	schema: typeof INBOX_RECEIPTS_SCHEMA;
	generated: string | null;
	pending: InboxReceipt[];
	handled: InboxReceipt[];
	/** Replies after the requested cursor, oldest first. */
	replies: InboxReply[];
	replyCursor: string;
	/** What the default bounds left out, and how to reveal it. */
	omitted: { surface: string; reveal: string | null }[];
}

export class ContractError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ContractError';
	}
}

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const nonBlank = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const bool = (v: unknown): boolean | null => (typeof v === 'boolean' ? v : null);
const obj = (v: unknown): Obj => (isObj(v) ? v : {});
const strings = (v: unknown): string[] =>
	Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

const CREW_STATES: readonly CrewState[] = [
	'working',
	'parked',
	'done',
	'blocked',
	'paused',
	'failed',
	'unknown'
];

function parseJson(text: string, what: string): unknown {
	const trimmed = text.trim();
	if (!trimmed) throw new ContractError(`${what} printed nothing`);
	try {
		return JSON.parse(trimmed);
	} catch {
		throw new ContractError(`${what} did not print valid JSON`);
	}
}

function parseBacklogRecord(v: unknown): BacklogRecord | null {
	if (!isObj(v)) return null;
	const id = str(v.id);
	if (!id) return null;
	const completion = obj(v.completion);
	return {
		id,
		state: str(v.state) ?? 'unknown',
		title: str(v.title),
		repo: str(v.repo),
		kind: nonBlank(v.kind),
		prUrl: str(v.pr_url),
		since: str(v.since),
		completion: { verb: str(completion.verb), date: str(completion.date) },
		captainActionable: v.captain_actionable === true,
		holdReason: str(v.hold_reason),
		holdBucket: str(v.hold_bucket),
		unresolvedBlockerIds: strings(v.unresolved_blocker_ids),
		bodyExcerpt: str(v.body_excerpt),
		order: num(v.order),
		structured: v.structured !== false
	};
}

function parseCurrentState(v: unknown): CurrentState | null {
	if (!isObj(v)) return null;
	const raw = str(v.state);
	const state = (CREW_STATES as readonly string[]).includes(raw ?? '')
		? (raw as CrewState)
		: 'unknown';
	return {
		state,
		source: str(v.source),
		detail: str(v.detail),
		observedAt: str(v.observed_at),
		freshness: str(v.freshness)
	};
}

function parseTask(v: unknown): SnapshotTask | null {
	if (!isObj(v)) return null;
	const id = str(v.id);
	if (!id) return null;
	const paths = obj(v.paths);
	const worktree = obj(paths.worktree);
	const report = obj(paths.report);
	const statusLog = obj(paths.status_log);
	const last = isObj(statusLog.last_event) ? statusLog.last_event : null;
	const endpoint = obj(v.endpoint);
	const hints = obj(v.hints);
	const decisions = Array.isArray(hints.open_decisions) ? hints.open_decisions : [];
	return {
		id,
		kind: nonBlank(v.kind),
		harness: nonBlank(v.harness),
		mode: nonBlank(v.mode),
		yolo: nonBlank(v.yolo),
		branch: nonBlank(v.branch),
		project: str(v.project),
		worktree: { path: str(worktree.path), present: worktree.present === true },
		report: { path: str(report.path), present: report.present === true },
		lastEvent: last
			? { state: str(last.state), note: str(last.note), ageSeconds: num(last.age_seconds) }
			: null,
		current: parseCurrentState(v.current_state),
		endpoint: {
			exists: bool(endpoint.exists),
			freshness: str(endpoint.freshness),
			target: nonBlank(endpoint.target)
		},
		prUrl: str(obj(v.pr).url),
		openDecisions: decisions.filter(isObj).map((d) => ({
			key: str(d.key),
			verb: str(d.verb),
			summary: str(d.summary)
		})),
		backlog: parseBacklogRecord(v.backlog)
	};
}

/** Parse `fm-fleet-snapshot.sh --json` output. Throws ContractError on mismatch. */
export function parseFleetSnapshot(text: string): FleetSnapshot {
	const v = parseJson(text, 'fm-fleet-snapshot.sh --json');
	if (!isObj(v)) throw new ContractError('fleet snapshot is not a JSON object');
	if (v.schema !== FLEET_SNAPSHOT_SCHEMA) {
		throw new ContractError(
			`fleet snapshot schema is ${JSON.stringify(v.schema ?? null)}, expected ${FLEET_SNAPSHOT_SCHEMA}`
		);
	}
	if (!Array.isArray(v.tasks)) throw new ContractError('fleet snapshot has no tasks[] array');
	const roots = obj(v.roots);
	const backlog = obj(v.backlog);
	const records = Array.isArray(backlog.records) ? backlog.records : [];
	return {
		schema: FLEET_SNAPSHOT_SCHEMA,
		generated: str(v.generated),
		fmHome: str(v.fm_home),
		roots: { fmRoot: str(roots.fm_root), data: str(roots.data), state: str(roots.state) },
		tasks: v.tasks.map(parseTask).filter((t): t is SnapshotTask => t !== null),
		backlog: {
			present: backlog.present === true,
			records: records.map(parseBacklogRecord).filter((r): r is BacklogRecord => r !== null)
		},
		orphanInFlight: strings(obj(v.main_inventory).orphan_in_flight)
	};
}

/** Parse `fm-inbox.sh ready` output. Throws ContractError on mismatch. */
export function parsePrimaryReady(text: string): PrimaryReady {
	const v = parseJson(text, 'fm-inbox.sh ready');
	if (!isObj(v)) throw new ContractError('readiness is not a JSON object');
	if (v.schema !== PRIMARY_READY_SCHEMA) {
		throw new ContractError(
			`readiness schema is ${JSON.stringify(v.schema ?? null)}, expected ${PRIMARY_READY_SCHEMA}`
		);
	}
	const lock = obj(v.lock);
	const consumer = obj(v.wake_consumer);
	const posture = obj(v.posture);
	const recv = v.can_receive;
	return {
		schema: PRIMARY_READY_SCHEMA,
		observedAt: str(v.observed_at),
		lock: { state: str(lock.state) ?? 'unknown', liveHarness: bool(lock.live_harness) },
		wakeConsumer: {
			state: str(consumer.state) ?? 'unknown',
			reason: str(consumer.reason),
			beaconAgeSeconds: num(consumer.beacon_age_seconds)
		},
		posture: str(posture.state),
		canReceive: recv === true ? true : recv === false ? false : 'unknown'
	};
}

/** Parse `fm-inbox.sh note --json` output. Throws ContractError on mismatch. */
export function parseInboxNote(text: string): InboxNoteResult {
	const v = parseJson(text, 'fm-inbox.sh note --json');
	if (!isObj(v)) throw new ContractError('note result is not a JSON object');
	if (v.schema !== INBOX_NOTE_SCHEMA) {
		throw new ContractError(
			`note result schema is ${JSON.stringify(v.schema ?? null)}, expected ${INBOX_NOTE_SCHEMA}`
		);
	}
	const noteId = nonBlank(v.id);
	if (!noteId) throw new ContractError('note result has no note id');
	if (v.outcome !== 'created' && v.outcome !== 'replay') {
		throw new ContractError(`note outcome ${JSON.stringify(v.outcome ?? null)} is not understood`);
	}
	return {
		schema: INBOX_NOTE_SCHEMA,
		outcome: v.outcome,
		noteId,
		requestId: nonBlank(v.request_id),
		saved: v.saved === true,
		announced: bool(v.announced),
		acknowledged: v.acknowledged === true
	};
}

function parseReply(v: unknown): InboxReply | null {
	if (!isObj(v)) return null;
	const noteId = nonBlank(v.id);
	const cursor = nonBlank(v.cursor);
	if (!noteId || !cursor) return null;
	return { noteId, at: str(v.at), body: str(v.body) ?? '', cursor };
}

function parseReceipt(v: unknown, acknowledged: boolean): InboxReceipt | null {
	if (!isObj(v)) return null;
	const noteId = nonBlank(v.id);
	if (!noteId) return null;
	return {
		noteId,
		at: str(v.at),
		source: str(v.source),
		requestId: nonBlank(v.request_id),
		body: str(v.body) ?? '',
		acknowledged: v.acknowledged === true || acknowledged,
		announced: bool(v.announced),
		reply: parseReply(v.reply)
	};
}

/** Parse `fm-inbox.sh receipts` output. Throws ContractError on mismatch. */
export function parseInboxReceipts(text: string): InboxReceipts {
	const v = parseJson(text, 'fm-inbox.sh receipts');
	if (!isObj(v)) throw new ContractError('receipts are not a JSON object');
	if (v.schema !== INBOX_RECEIPTS_SCHEMA) {
		throw new ContractError(
			`receipts schema is ${JSON.stringify(v.schema ?? null)}, expected ${INBOX_RECEIPTS_SCHEMA}`
		);
	}
	if (!Array.isArray(v.pending) || !Array.isArray(v.handled) || !Array.isArray(v.replies)) {
		throw new ContractError('receipts lack pending[], handled[] or replies[]');
	}
	const omitted = Array.isArray(v.omitted) ? v.omitted.filter(isObj) : [];
	return {
		schema: INBOX_RECEIPTS_SCHEMA,
		generated: str(v.generated),
		pending: v.pending.map((n) => parseReceipt(n, false)).filter((n) => n !== null),
		handled: v.handled.map((n) => parseReceipt(n, true)).filter((n) => n !== null),
		replies: v.replies.map(parseReply).filter((r) => r !== null),
		replyCursor: str(v.reply_cursor) ?? '',
		omitted: omitted.map((o) => ({ surface: str(o.surface) ?? '', reveal: str(o.reveal) }))
	};
}

// Strips terminal escape sequences and control characters other than tab and
// newline, so a captured pane renders as plain text.
// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u001b[@-_]/g;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f]/g;

/** Turn raw `fm-peek.sh` output into at most `maxLines` clean lines. */
export function parsePeekOutput(text: string, maxLines: number): string[] {
	const lines = text.replace(/\r\n?/g, '\n').replace(ANSI, '').replace(CONTROL, '').split('\n');
	while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
	return lines.slice(-maxLines);
}
