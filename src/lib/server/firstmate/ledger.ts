import { createHash } from 'node:crypto';
import { open, stat } from 'node:fs/promises';
import { previewNoteOf } from '../../previewnote';

/**
 * Read-only tail of Firstmate's fleet activity ledger (state/fleet-ledger.jsonl,
 * contract in Firstmate's docs/fleet-ledger.md). The ledger survives task
 * cleanup, so it supplies timelines, worker identity, PR-ready and merge times.
 *
 * Contract notes this reader honours: records are append-only JSON lines with
 * `v`, `ts`, `event`, `task`; unknown members and events are ignored; delivery
 * is at least once (duplicates are dropped here); there are no sequence
 * numbers; the file may be truncated to empty, in which case we start over.
 * Status text is history, never current state.
 */

export interface LedgerStatus {
	ts: number;
	state: string | null;
	key: string | null;
	text: string;
}

export interface LedgerTask {
	id: string;
	dispatched: {
		ts: number;
		kind: string | null;
		project: string | null;
		harness: string | null;
		model: string | null;
	} | null;
	statuses: LedgerStatus[];
	prReady: { ts: number; pr: string } | null;
	merged: { ts: number; via: string | null; pr: string | null } | null;
	cleanedUpAt: number | null;
	/** Latest preview a status line named (`preview <url>`, or an address on this machine; previewnote.ts). */
	preview: { ts: number; url: string } | null;
	/** Latest review board (a Lavish board session) a status line named. */
	board: { ts: number; url: string } | null;
	/** no-mistakes run ids seen in decision keys (`nm-<run>-<step>`). */
	runIds: string[];
}

export interface LedgerState {
	available: boolean;
	reason: string | null;
	tasks: Map<string, LedgerTask>;
}

const MAX_STATUSES_PER_TASK = 200;
const MAX_SEEN_LINES = 10_000;
const INITIAL_TAIL_BYTES = 4 * 1024 * 1024;
const MAX_READ_BYTES = 2 * 1024 * 1024;
const NM_KEY = /^nm-([0-9A-Z]{26})-/;

const str = (v: unknown) => (typeof v === 'string' ? v : null);

/** 48 bits of a line's SHA-1: a repeat check that holds no part of the line. */
const lineHash = (line: string) => createHash('sha1').update(line).digest().readUIntBE(0, 6);

export interface LedgerReaderOptions {
	/**
	 * Days a task's history is kept in memory after Firstmate cleaned it up
	 * (default KEEP_CLEANED_DAYS); null keeps every task read.
	 */
	keepCleanedDays?: number | null;
	/** Epoch seconds. */
	now?: () => number;
}

/** Days a cleaned-up task's history stays in memory unless configured otherwise. */
export const KEEP_CLEANED_DAYS = 30;
/** How often tasks cleaned up long ago are let go, in seconds. */
const EVICT_EVERY_SEC = 600;

/** `WHEELHOUSE_LEDGER_KEEP_DAYS`: a number of days, or `all` (or 0) to keep every task read. */
export function keepCleanedDays(env: NodeJS.ProcessEnv): number | null {
	const v = env.WHEELHOUSE_LEDGER_KEEP_DAYS?.trim().toLowerCase();
	if (!v) return KEEP_CLEANED_DAYS;
	if (v === 'all' || v === '0') return null;
	const n = Number(v);
	return Number.isFinite(n) && n > 0 ? n : KEEP_CLEANED_DAYS;
}

export class LedgerReader {
	private offset = 0;
	/** The start of a line still being written, copied out of the read it came in. */
	private partial: Buffer = Buffer.alloc(0);
	/** Hashes of the lines applied, to drop repeats (a line itself would keep its whole read alive). */
	private seen = new Set<number>();
	private tasks = new Map<string, LedgerTask>();
	private present = false;
	private problem: string | null = null;
	/** Task ids touched by the most recent poll. */
	changed = new Set<string>();

	private keepCleanedSec: number | null;
	private now: () => number;
	private evictedAt = Number.NEGATIVE_INFINITY;

	constructor(
		private file: string,
		opts: LedgerReaderOptions = {}
	) {
		const days = opts.keepCleanedDays === undefined ? KEEP_CLEANED_DAYS : opts.keepCleanedDays;
		this.keepCleanedSec = days === null ? null : days * 86_400;
		this.now = opts.now ?? (() => Math.floor(Date.now() / 1000));
	}

	state(): LedgerState {
		return {
			available: this.present,
			reason: this.present
				? null
				: (this.problem ??
					'Firstmate’s fleet activity ledger is off, so history after cleanup is not kept.'),
			tasks: this.tasks
		};
	}

	task(id: string): LedgerTask | null {
		return this.tasks.get(id) ?? null;
	}

	/** Read whatever was appended since the last poll. Never throws. */
	async poll(): Promise<number> {
		this.changed = new Set();
		const count = await this.read();
		this.evict();
		return count;
	}

	private async read(): Promise<number> {
		let size: number;
		try {
			size = (await stat(this.file)).size;
		} catch {
			this.present = false;
			this.problem = null;
			return 0;
		}
		this.present = true;
		if (size < this.offset) this.reset();
		if (size === this.offset) return 0;

		let start = this.offset;
		let skipFirstLine = false;
		if (start === 0 && size > INITIAL_TAIL_BYTES) {
			start = size - INITIAL_TAIL_BYTES;
			skipFirstLine = true;
		}
		const length = Math.min(size - start, MAX_READ_BYTES);
		let chunk: Buffer;
		try {
			const fh = await open(this.file, 'r');
			try {
				const buf = Buffer.alloc(length);
				const { bytesRead } = await fh.read(buf, 0, length, start);
				chunk = Buffer.concat([this.partial, buf.subarray(0, bytesRead)]);
				this.offset = start + bytesRead;
			} finally {
				await fh.close();
			}
		} catch (e) {
			this.problem = `Could not read the fleet ledger: ${(e as Error).message}`;
			return 0;
		}
		const end = chunk.lastIndexOf(0x0a) + 1;
		this.partial = Buffer.from(chunk.subarray(end));
		const lines = chunk.subarray(0, end).toString('utf8').split('\n');
		lines.pop();
		if (skipFirstLine) lines.shift();
		let count = 0;
		for (const line of lines) if (this.ingest(line)) count++;
		return count;
	}

	/** Lets go of tasks Firstmate cleaned up longer ago than the configured days. */
	private evict() {
		const now = this.now();
		if (this.keepCleanedSec === null || now - this.evictedAt < EVICT_EVERY_SEC) return;
		this.evictedAt = now;
		const cutoff = now - this.keepCleanedSec;
		for (const [id, t] of this.tasks)
			if (t.cleanedUpAt !== null && t.cleanedUpAt < cutoff) this.tasks.delete(id);
	}

	private reset() {
		this.offset = 0;
		this.partial = Buffer.alloc(0);
		this.seen.clear();
		this.tasks.clear();
	}

	private entry(id: string): LedgerTask {
		let t = this.tasks.get(id);
		if (!t) {
			t = {
				id,
				dispatched: null,
				statuses: [],
				prReady: null,
				merged: null,
				cleanedUpAt: null,
				preview: null,
				board: null,
				runIds: []
			};
			this.tasks.set(id, t);
		}
		return t;
	}

	/** Apply one JSON line. Returns true when it was a new, recognised record. */
	ingest(line: string): boolean {
		const trimmed = line.trim();
		if (!trimmed) return false;
		const hash = lineHash(trimmed);
		if (this.seen.has(hash)) return false;
		let r: Record<string, unknown>;
		try {
			const v = JSON.parse(trimmed);
			if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
			r = v;
		} catch {
			return false;
		}
		const id = str(r.task);
		const ts = typeof r.ts === 'number' ? r.ts : null;
		if (r.v !== 1 || !id || ts === null) return false;
		this.seen.add(hash);
		if (this.seen.size > MAX_SEEN_LINES) this.seen.delete(this.seen.values().next().value!);
		const t = this.entry(id);
		switch (r.event) {
			case 'task.dispatched':
				t.dispatched = {
					ts,
					kind: str(r.kind),
					project: str(r.project),
					harness: str(r.harness),
					model: str(r.model)
				};
				break;
			case 'task.status': {
				const s = { ts, state: str(r.state), key: str(r.key), text: (str(r.text) ?? '').trim() };
				t.statuses.push(s);
				if (t.statuses.length > MAX_STATUSES_PER_TASK) t.statuses.shift();
				const note = previewNoteOf(s.text);
				if (note.preview) t.preview = { ts, url: note.preview };
				if (note.board) t.board = { ts, url: note.board };
				const nm = s.key ? NM_KEY.exec(s.key) : null;
				if (nm && !t.runIds.includes(nm[1])) t.runIds.push(nm[1]);
				break;
			}
			case 'task.pr_ready': {
				const pr = str(r.pr);
				if (pr) t.prReady = { ts, pr };
				break;
			}
			case 'task.merged':
				t.merged = { ts, via: str(r.via), pr: str(r.pr) };
				break;
			case 'task.cleaned_up':
				t.cleanedUpAt = ts;
				break;
			default:
				return false;
		}
		this.changed.add(id);
		return true;
	}
}
