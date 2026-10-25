import { open, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import type { AllowanceWindow } from '../../types';

/**
 * Claude headroom: the allowance quota-axi reports, and who on this machine is
 * using it, from the token counts in local Claude Code transcripts.
 *
 * Only these transcript fields are read: `timestamp`, `cwd`, `gitBranch` and
 * `message.usage`. Message text is never parsed or kept.
 */

// ------------------------------------------------------------------ attribution

export interface AttributionContext {
	firstmateDir: string;
	homeDir: string;
	/** no-mistakes worktrees (~/.no-mistakes/worktrees). */
	nmWorktreesDir: string | null;
	/** no-mistakes run id → task id. */
	runTask: (runId: string) => string | null;
	/** Known task ids (from the fleet ledger and the snapshot). */
	isTask: (id: string) => boolean;
}

/** Who a session belongs to: firstmate | other | task:<id> | review:<id>. */
export type Who = string;

const inside = (p: string, dir: string | null) =>
	!!dir && (p === dir || p.startsWith(dir.endsWith(path.sep) ? dir : dir + path.sep));

/**
 * Attribute one session by where it ran and the branch it was on. A worker's
 * branch is `fm/<task>`; a validation run's agents run in the no-mistakes
 * worktree named after the run id. Returns null when it cannot tell yet
 * (a worker session before it checks out its branch).
 */
export function attribute(
	cwd: string | null,
	branch: string | null,
	ctx: AttributionContext
): Who | null {
	if (cwd && inside(cwd, ctx.nmWorktreesDir)) {
		const rest = path.relative(ctx.nmWorktreesDir!, cwd).split(path.sep);
		const run = rest.find((s) => /^[0-9A-Z]{26}$/.test(s));
		const task = run ? ctx.runTask(run) : null;
		return task ? `review:${task}` : 'other';
	}
	const b = branch?.startsWith('fm/') ? branch.slice(3) : null;
	if (b && ctx.isTask(b)) return `task:${b}`;
	if (cwd && (inside(cwd, ctx.firstmateDir) || inside(cwd, ctx.homeDir))) return 'firstmate';
	if (!cwd) return null;
	return branch === 'HEAD' || branch === null ? null : 'other';
}

/** Rough relative cost of one response: writing counts more than re-reading. */
export function weight(u: Record<string, unknown>): number {
	const n = (k: string) => (typeof u[k] === 'number' ? (u[k] as number) : 0);
	return (
		n('input_tokens') +
		1.25 * n('cache_creation_input_tokens') +
		0.1 * n('cache_read_input_tokens') +
		5 * n('output_tokens')
	);
}

// ------------------------------------------------------------------ transcripts

interface Row {
	ts: number;
	w: number;
}

interface FileState {
	offset: number;
	partial: string;
	who: Who | null;
	cwd: string | null;
	/** Rows seen before the session could be attributed. */
	pending: Row[];
}

const WEEK = 7 * 86400;
const MAX_FILE_BYTES = 32 * 1024 * 1024;
const MAX_POLL_BYTES = 64 * 1024 * 1024;

/**
 * Incremental reader of transcript token counts: each poll reads only what was
 * appended since the last one, bounded per poll, and keeps a week of rows.
 */
export class TranscriptUsage {
	private files = new Map<string, FileState>();
	private rows = new Map<Who, Row[]>();

	constructor(
		private root: string,
		private ctx: () => AttributionContext
	) {}

	async poll(now: number): Promise<void> {
		let budget = MAX_POLL_BYTES;
		let dirs: string[];
		try {
			dirs = await readdir(this.root);
		} catch {
			return;
		}
		const ctx = this.ctx();
		for (const d of dirs) {
			let names: string[];
			try {
				names = (await readdir(path.join(this.root, d))).filter((n) => n.endsWith('.jsonl'));
			} catch {
				continue;
			}
			for (const n of names) {
				const file = path.join(this.root, d, n);
				const st = await stat(file).catch(() => null);
				if (!st?.isFile() || st.mtimeMs / 1000 < now - WEEK) continue;
				budget -= await this.read(file, st.size, ctx, budget);
				if (budget <= 0) break;
			}
			if (budget <= 0) break;
		}
		for (const [who, rows] of this.rows) {
			const keep = rows.filter((r) => r.ts >= now - WEEK);
			if (keep.length) this.rows.set(who, keep);
			else this.rows.delete(who);
		}
		for (const f of this.files.values()) f.pending = f.pending.filter((r) => r.ts >= now - WEEK);
	}

	private async read(file: string, size: number, ctx: AttributionContext, budget: number) {
		let f = this.files.get(file);
		if (!f || size < f.offset) {
			f = {
				offset: Math.max(0, size - MAX_FILE_BYTES),
				partial: '',
				who: null,
				cwd: null,
				pending: []
			};
			this.files.set(file, f);
		}
		const length = Math.min(size - f.offset, budget);
		if (length <= 0) return 0;
		let text: string;
		const fh = await open(file, 'r').catch(() => null);
		if (!fh) return 0;
		try {
			const buf = Buffer.alloc(length);
			const { bytesRead } = await fh.read(buf, 0, length, f.offset);
			text = buf.subarray(0, bytesRead).toString('utf8');
			f.offset += bytesRead;
		} finally {
			await fh.close();
		}
		const lines = (f.partial + text).split('\n');
		f.partial = lines.pop() ?? '';
		for (const l of lines) this.line(f, l, ctx);
		return length;
	}

	private line(f: FileState, l: string, ctx: AttributionContext) {
		// Cheap filter before parsing: only lines that carry usage or a branch.
		if (!l.includes('"usage"') && !l.includes('"gitBranch"')) return;
		let r: Record<string, unknown>;
		try {
			r = JSON.parse(l);
		} catch {
			return;
		}
		if (typeof r.cwd === 'string') f.cwd = r.cwd;
		const branch = typeof r.gitBranch === 'string' ? r.gitBranch : null;
		if (!f.who || f.who === 'other' || f.who === 'firstmate') {
			const who = attribute(f.cwd, branch, ctx);
			if (who && who !== f.who && (who.startsWith('task:') || !f.who)) {
				f.who = who;
				if (f.pending.length) this.add(who, f.pending.splice(0));
			}
		}
		const msg = r.message as Record<string, unknown> | undefined;
		const usage = msg && typeof msg === 'object' ? (msg.usage as Record<string, unknown>) : null;
		const ts = typeof r.timestamp === 'string' ? Date.parse(r.timestamp) / 1000 : NaN;
		if (!usage || typeof usage !== 'object' || !Number.isFinite(ts)) return;
		const row = { ts, w: weight(usage) };
		if (f.who) this.add(f.who, [row]);
		else f.pending.push(row);
	}

	private add(who: Who, rows: Row[]) {
		const list = this.rows.get(who) ?? [];
		list.push(...rows);
		this.rows.set(who, list);
	}

	/** Rows of sessions never attributed count as other use. */
	private settled(): Map<Who, Row[]> {
		const out = new Map(this.rows);
		const loose = [...this.files.values()].flatMap((f) => (f.who ? [] : f.pending));
		if (loose.length) out.set('other', [...(out.get('other') ?? []), ...loose]);
		return out;
	}

	/** Weighted use per consumer over the last 5 hours and 7 days, and per hour for a day. */
	totals(now: number): { who: Who; fiveHour: number; week: number }[] {
		const out: { who: Who; fiveHour: number; week: number }[] = [];
		for (const [who, rows] of this.settled()) {
			let fiveHour = 0;
			let week = 0;
			for (const r of rows) {
				if (r.ts < now - WEEK) continue;
				week += r.w;
				if (r.ts >= now - 5 * 3600) fiveHour += r.w;
			}
			if (week > 0) out.push({ who, fiveHour, week });
		}
		return out;
	}

	/** Weighted use per hour over the last 24 hours, oldest first. */
	hourly(now: number): number[] {
		const h = Array<number>(24).fill(0);
		for (const rows of this.settled().values())
			for (const r of rows) {
				const i = Math.floor((now - r.ts) / 3600);
				if (i >= 0 && i < 24) h[23 - i] += r.w;
			}
		return h;
	}
}

// ------------------------------------------------------------------ allowance

export type Allowance =
	| { state: 'ok'; windows: Omit<AllowanceWindow, 'runsOutAt'>[]; runwayShort: Set<string> }
	| { state: 'connect'; command: string }
	| { state: 'unavailable'; reason: string };

export const CONNECT_COMMAND = 'quota-axi --allow-keychain-prompt';

const PLAIN: [RegExp, string][] = [
	[/five|5.?h|session/i, 'This session'],
	[/opus/i, 'This week, Opus'],
	[/sonnet/i, 'This week, Sonnet'],
	[/seven|7.?d|week/i, 'This week']
];

function plainLabel(id: string, label: string | null): string {
	const s = `${id} ${label ?? ''}`;
	for (const [re, l] of PLAIN) if (re.test(s)) return l;
	return label ? label.charAt(0).toUpperCase() + label.slice(1) : id;
}

/** Parse `quota-axi --provider claude --json` output. */
export function parseAllowance(json: string): Allowance {
	let doc: Record<string, unknown>;
	try {
		doc = JSON.parse(json);
	} catch {
		return {
			state: 'unavailable',
			reason: 'quota-axi printed something Wheelhouse could not read.'
		};
	}
	const providers = Array.isArray(doc.providers)
		? (doc.providers as Record<string, unknown>[])
		: [];
	const p = providers.find((x) => x.provider === 'claude');
	if (!p || p.notSetUp)
		return { state: 'unavailable', reason: 'quota-axi has no Claude account set up.' };
	const st = (p.state ?? {}) as Record<string, unknown>;
	if (st.status === 'auth_required') return { state: 'connect', command: CONNECT_COMMAND };
	const raw = Array.isArray(p.windows) ? (p.windows as Record<string, unknown>[]) : [];
	const windows = raw
		.filter((w) => typeof w.id === 'string' && typeof w.percentRemaining === 'number')
		.map((w) => ({
			id: w.id as string,
			label: plainLabel(w.id as string, typeof w.label === 'string' ? w.label : null),
			percentLeft: Math.max(0, Math.min(100, Math.round(w.percentRemaining as number))),
			resetsAt: typeof w.resetsAt === 'string' ? w.resetsAt : null
		}));
	if (!windows.length) {
		return {
			state: 'unavailable',
			reason:
				typeof st.error === 'string'
					? `quota-axi could not read Claude’s limits (${st.error}).`
					: 'quota-axi reported no Claude limits.'
		};
	}
	// quota-axi's own runway projection, when it gives one.
	const runwayShort = new Set<string>();
	const sem = (p.quotaSemantics ?? {}) as Record<string, unknown>;
	for (const a of Array.isArray(sem.effectiveAvailability)
		? (sem.effectiveAvailability as Record<string, unknown>[])
		: []) {
		const rw = (a.runway ?? {}) as Record<string, unknown>;
		const status = typeof rw.status === 'string' ? rw.status : null;
		if (status && status !== 'through_reset' && status !== 'unknown') {
			for (const id of Array.isArray(a.limitingWindowIds) ? (a.limitingWindowIds as string[]) : [])
				runwayShort.add(id);
		}
	}
	return { state: 'ok', windows, runwayShort };
}

/**
 * When a window runs out at the recent pace: the slope of what is left across
 * the readings of the last hour. Null when it lasts until it resets, or when
 * there is not enough to go on (under 10 minutes of readings).
 */
export function runsOutAt(
	samples: { at: number; percentLeft: number }[],
	resetsAt: number | null,
	now: number
): number | null {
	const recent = samples.filter((s) => s.at >= now - 3600).sort((a, b) => a.at - b.at);
	if (recent.length < 2) return null;
	const first = recent[0];
	const last = recent[recent.length - 1];
	const span = last.at - first.at;
	if (span < 600) return null;
	const perSecond = (first.percentLeft - last.percentLeft) / span;
	if (perSecond <= 0) return null;
	const at = last.at + last.percentLeft / perSecond;
	return resetsAt !== null && at >= resetsAt ? null : at;
}
