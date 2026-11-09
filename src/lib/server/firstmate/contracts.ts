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
	/** When the captain hold was set (`Captain hold set:` stamp), a date or UTC time. */
	holdSet: string | null;
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
	/**
	 * Registered second mates (`secondmate_current`), each with its home's
	 * structured summary; null when the snapshot has no such section (an older
	 * Firstmate).
	 */
	secondMates: SecondMateCurrent | null;
}

/** `secondmate_current`: bounded current summaries of the registered second mates. */
export interface SecondMateCurrent {
	records: SecondMateRecord[];
	/** How many second mates there are, and how many the snapshot left out by its bound. */
	total: number;
	truncated: number;
}

/** A second-mate home's in-flight child that crew state reads as working. */
export interface MateActiveChild {
	id: string;
	kind: string | null;
	repo: string | null;
	name: string | null;
	source: string | null;
	doing: string | null;
}

/** An open question in a second mate's home: a captain hold, or a child's status-line decision. */
export interface MateDecision {
	/** The child task it is about. */
	id: string;
	key: string | null;
	verb: string | null;
	summary: string | null;
	reason: string | null;
	/** The full question, for a captain hold. */
	question: string | null;
	/** `backlog` (a captain hold) or `status` (a child's decision). */
	source: string | null;
}

/** Work in a second mate's home held or blocked (by a blocker, a hold, or its child's state). */
export interface MateHold {
	id: string;
	title: string | null;
	blockedBy: string | null;
	reason: string | null;
	source: string | null;
}

/** A queued (or held) backlog row in a second mate's home. */
export interface MateQueued {
	id: string;
	title: string | null;
	question: string | null;
	blockedBy: string | null;
	holdReason: string | null;
	holdKind: string | null;
	holdBucket: string | null;
	captainActionable: boolean;
	repo: string | null;
	kind: string | null;
	since: string | null;
}

/** A landed (done) backlog row in a second mate's home. */
export interface MateLanded {
	id: string;
	title: string | null;
	kind: string | null;
	prUrl: string | null;
	reportPath: string | null;
	completion: { verb: string | null; date: string | null };
}

/** A child worker's endpoint and crew state in a second mate's home. */
export interface MateEndpoint {
	id: string;
	state: string | null;
	source: string | null;
	exists: boolean | null;
	target: string | null;
}

export interface SecondMateRecord {
	id: string;
	home: string | null;
	/** The SSH alias of a remote second mate's host; null for a local one. */
	host: string | null;
	remote: boolean;
	registered: boolean | null;
	/**
	 * The home's classification: captain_decision, active_child_work,
	 * externally_held, no_active_work, or unknown (with `reason`).
	 */
	state: string;
	reason: string | null;
	/** `structured-home` when the home's summary was read, else a fallback. */
	provenance: string | null;
	/** local-ledger, remote-ledger, or remote-ledger-cache (the host could not be read now). */
	summarySource: string | null;
	freshness: { status: string | null; observedAt: string | null; ageSeconds: number | null };
	active: MateActiveChild[];
	decisions: MateDecision[];
	holds: MateHold[];
	queued: MateQueued[];
	landed: MateLanded[];
	endpoints: MateEndpoint[];
	/** Each list's full size in the home, before the snapshot's bounds. */
	counts: Record<string, number>;
	/** The parent's last status line from this second mate (history, not current state). */
	parentEvent: { note: string | null; ageSeconds: number | null } | null;
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
		holdSet: str(v.hold_set),
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
		orphanInFlight: strings(obj(v.main_inventory).orphan_in_flight),
		secondMates: parseSecondMates(v.secondmate_current)
	};
}

/** A list of objects, each read by `f`, dropping the ones it refuses. */
function list<T>(v: unknown, f: (o: Obj) => T | null): T[] {
	return Array.isArray(v)
		? v
				.filter(isObj)
				.map(f)
				.filter((x): x is T => x !== null)
		: [];
}

function withId<T>(o: Obj, f: (id: string) => T): T | null {
	const id = nonBlank(o.id);
	return id ? f(id) : null;
}

function parseSecondMate(v: Obj): SecondMateRecord | null {
	return withId(v, (id) => {
		const current = obj(v.current);
		const provenance = obj(v.provenance);
		const freshness = obj(v.freshness);
		const parent = isObj(v.parent_event) ? v.parent_event : null;
		const counts: Record<string, number> = {};
		for (const [k, n] of Object.entries(obj(v.counts))) {
			const c = num(n);
			if (c !== null) counts[k] = c;
		}
		return {
			id,
			home: nonBlank(v.home),
			host: nonBlank(v.host),
			remote: v.remote === true,
			registered: bool(v.registered),
			state: nonBlank(current.state) ?? 'unknown',
			reason: nonBlank(current.reason),
			provenance: nonBlank(provenance.selected),
			summarySource: nonBlank(provenance.summary_source),
			freshness: {
				status: nonBlank(freshness.status),
				observedAt: nonBlank(freshness.observed_at),
				ageSeconds: num(freshness.age_seconds)
			},
			active: list(v.active_children, (c) =>
				withId(c, (cid) => ({
					id: cid,
					kind: nonBlank(c.kind),
					repo: nonBlank(c.repo),
					name: nonBlank(c.name),
					source: nonBlank(c.source),
					doing: nonBlank(c.doing)
				}))
			),
			decisions: list(v.decisions_open, (d) =>
				withId(d, (did) => ({
					id: did,
					key: nonBlank(d.key),
					verb: nonBlank(d.verb),
					summary: nonBlank(d.summary),
					reason: nonBlank(d.reason),
					question: nonBlank(d.question),
					source: nonBlank(d.source)
				}))
			),
			holds: list(v.holds, (h) =>
				withId(h, (hid) => ({
					id: hid,
					title: nonBlank(h.title),
					blockedBy: nonBlank(h.blocked_by),
					reason: nonBlank(h.reason),
					source: nonBlank(h.source)
				}))
			),
			queued: list(v.queued, (q) =>
				withId(q, (qid) => ({
					id: qid,
					title: nonBlank(q.title),
					question: nonBlank(q.question),
					blockedBy: nonBlank(q.blocked_by),
					holdReason: nonBlank(q.hold_reason),
					holdKind: nonBlank(q.hold_kind),
					holdBucket: nonBlank(q.hold_bucket),
					captainActionable: q.captain_actionable === true,
					repo: nonBlank(q.repo),
					kind: nonBlank(q.kind),
					since: nonBlank(q.since)
				}))
			),
			landed: list(v.landed, (l) =>
				withId(l, (lid) => {
					const completion = obj(l.completion);
					return {
						id: lid,
						title: nonBlank(l.title),
						kind: nonBlank(l.kind),
						prUrl: nonBlank(l.pr_url),
						reportPath: nonBlank(l.report_path),
						completion: { verb: nonBlank(completion.verb), date: nonBlank(completion.date) }
					};
				})
			),
			endpoints: list(v.endpoints, (e) =>
				withId(e, (eid) => {
					const ep = obj(e.endpoint);
					return {
						id: eid,
						state: nonBlank(e.state),
						source: nonBlank(e.source),
						exists: bool(ep.exists),
						target: nonBlank(ep.target)
					};
				})
			),
			counts,
			parentEvent: parent
				? { note: nonBlank(parent.note), ageSeconds: num(parent.age_seconds) }
				: null
		};
	});
}

/** `secondmate_current`, leniently: a malformed record is dropped, never the whole snapshot. */
function parseSecondMates(v: unknown): SecondMateCurrent | null {
	if (!isObj(v)) return null;
	const records = list(v.records, parseSecondMate);
	return {
		records,
		total: num(v.total) ?? records.length,
		truncated: num(v.truncated) ?? 0
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
