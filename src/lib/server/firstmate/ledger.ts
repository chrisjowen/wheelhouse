import { open, stat } from 'node:fs/promises';

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
	/** Latest URL reported with the `preview <url>` status convention. */
	preview: { ts: number; url: string } | null;
	/** no-mistakes run ids seen in decision keys (`nm-<run>-<step>`). */
	runIds: string[];
}

export interface LedgerState {
	available: boolean;
	reason: string | null;
	tasks: Map<string, LedgerTask>;
}

const MAX_STATUSES_PER_TASK = 200;
const INITIAL_TAIL_BYTES = 4 * 1024 * 1024;
const MAX_READ_BYTES = 2 * 1024 * 1024;
const PREVIEW = /^\s*preview:?\s+(https?:\/\/\S+)/i;
const NM_KEY = /^nm-([0-9A-Z]{26})-/;

const str = (v: unknown) => (typeof v === 'string' ? v : null);

export class LedgerReader {
	private offset = 0;
	private partial = '';
	private seen = new Set<string>();
	private tasks = new Map<string, LedgerTask>();
	private present = false;
	private problem: string | null = null;
	/** Task ids touched by the most recent poll. */
	changed = new Set<string>();

	constructor(private file: string) {}

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
		let text: string;
		try {
			const fh = await open(this.file, 'r');
			try {
				const buf = Buffer.alloc(length);
				const { bytesRead } = await fh.read(buf, 0, length, start);
				text = buf.subarray(0, bytesRead).toString('utf8');
				this.offset = start + bytesRead;
			} finally {
				await fh.close();
			}
		} catch (e) {
			this.problem = `Could not read the fleet ledger: ${(e as Error).message}`;
			return 0;
		}
		text = this.partial + text;
		const lines = text.split('\n');
		this.partial = lines.pop() ?? '';
		if (skipFirstLine) lines.shift();
		let count = 0;
		for (const line of lines) if (this.ingest(line)) count++;
		return count;
	}

	private reset() {
		this.offset = 0;
		this.partial = '';
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
				runIds: []
			};
			this.tasks.set(id, t);
		}
		return t;
	}

	/** Apply one JSON line. Returns true when it was a new, recognised record. */
	ingest(line: string): boolean {
		const trimmed = line.trim();
		if (!trimmed || this.seen.has(trimmed)) return false;
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
		this.seen.add(trimmed);
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
				const p = PREVIEW.exec(s.text);
				if (p) t.preview = { ts, url: p[1].replace(/[),.;]+$/, '') };
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
