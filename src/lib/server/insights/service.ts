import { open, readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { runBounded } from '../firstmate/exec';
import type { LedgerTask } from '../firstmate/ledger';
import type {
	AllowanceWindow,
	DecisionView,
	DecisionsView,
	HeadroomView,
	TimeSplit,
	TimeView,
	UsageShare,
	WorkEta
} from '../../types';
import {
	callsFor,
	fullAnswer,
	gist,
	overall,
	pairDecisions,
	parseFindings,
	type Finding
} from './decisions';
import { estimate, splitTime, type EtaSubject, type RunTiming } from './timing';
import { parseAllowance, runsOutAt, TranscriptUsage, type Allowance } from './usage';

/**
 * Read-only insights over Firstmate's records, kept by the collector:
 * - where each task's time went and a work-time estimate, from the fleet
 *   ledger and the no-mistakes step logs (~/.no-mistakes/logs/<run>/<step>.log,
 *   whose creation and last-write times bound each step);
 * - review questions Firstmate answered on the captain's behalf, from the
 *   ledger, the findings files under data/<task>/ and, while the task lives,
 *   its handled inbox messages (state/<task>.inbox/handled/);
 * - Claude headroom, from `quota-axi` (never with --allow-keychain-prompt) and
 *   the token counts of local Claude Code transcripts.
 * Nothing here writes anywhere.
 */

export interface TaskMeta {
	title: string;
	projectId: string | null;
	kind: string | null;
	live: boolean;
}

export interface InsightsOptions {
	homeDir: string;
	firstmateDir: string;
	/** no-mistakes run logs (null disables run timings). */
	logsDir: string | null;
	/** no-mistakes worktrees, where validation agents run. */
	nmWorktreesDir: string | null;
	/** Claude Code's projects directory (transcripts); null disables usage. */
	claudeProjectsDir: string | null;
	env?: NodeJS.ProcessEnv;
	/** Reads `quota-axi --provider claude --json` output; null when it cannot run. */
	readQuota?: () => Promise<{ ok: true; stdout: string } | { ok: false; reason: string }>;
	/** Epoch seconds. */
	now?: () => number;
	usageIntervalSec?: number;
}

const RUN_ID = /^[0-9A-Z]{26}$/;
const BRANCH = /(?:refs\/heads\/|origin\/|branch )fm\/([A-Za-z0-9._-]+)/;
const STEPS = new Set([
	'intent',
	'rebase',
	'review',
	'test',
	'document',
	'lint',
	'push',
	'pr',
	'ci'
]);
const HEAD_BYTES = 8192;
const MAX_HANDLED = 40;
const MAX_FINDINGS_BYTES = 256 * 1024;
const SAMPLES_KEPT = 120;

async function head(file: string, max: number): Promise<string | null> {
	const fh = await open(file, 'r').catch(() => null);
	if (!fh) return null;
	try {
		const buf = Buffer.alloc(max);
		const { bytesRead } = await fh.read(buf, 0, max, 0);
		return buf.subarray(0, bytesRead).toString('utf8');
	} finally {
		await fh.close();
	}
}

async function tail(file: string, max: number): Promise<string | null> {
	const st = await stat(file).catch(() => null);
	if (!st?.isFile()) return null;
	const fh = await open(file, 'r').catch(() => null);
	if (!fh) return null;
	try {
		const len = Math.min(st.size, max);
		const buf = Buffer.alloc(len);
		const { bytesRead } = await fh.read(buf, 0, len, st.size - len);
		return buf.subarray(0, bytesRead).toString('utf8');
	} finally {
		await fh.close();
	}
}

const inside = (p: string, dir: string) => p === dir || p.startsWith(dir + path.sep);

/** A task Firstmate no longer lists: its id in plain words rather than as an id. */
const readable = (id: string) => {
	const s = id.replace(/[-_]+/g, ' ').trim();
	return s.charAt(0).toUpperCase() + s.slice(1);
};

export class InsightsService {
	private now: () => number;
	private dataDir: string;
	/** Run id → task id, from the branch its logs name (never changes). */
	private runTask = new Map<string, string | null>();
	/** When a run's logs last failed to name a branch (a run just starting has none yet). */
	private runTried = new Map<string, number>();
	private timings = new Map<string, RunTiming | null>();
	private findings = new Map<string, Finding[]>();
	private handled = new Map<string, string[]>();
	private ledger = new Map<string, LedgerTask>();
	private meta = new Map<string, TaskMeta>();
	private splits = new Map<string, TimeSplit>();
	private usage: TranscriptUsage | null;
	private usageAt = Number.NEGATIVE_INFINITY;
	private allowance: Allowance | null = null;
	private allowanceAt: number | null = null;
	private samples = new Map<string, { at: number; percentLeft: number }[]>();
	private usageRunning: Promise<void> | null = null;

	constructor(private opts: InsightsOptions) {
		this.now = opts.now ?? (() => Math.floor(Date.now() / 1000));
		this.dataDir = path.join(opts.homeDir, 'data');
		this.usage = opts.claudeProjectsDir
			? new TranscriptUsage(opts.claudeProjectsDir, () => ({
					firstmateDir: opts.firstmateDir,
					homeDir: opts.homeDir,
					nmWorktreesDir: opts.nmWorktreesDir,
					runTask: (r) => this.runTask.get(r) ?? this.ledgerRunTask(r),
					isTask: (id) => this.ledger.has(id) || this.meta.has(id)
				}))
			: null;
	}

	setDataDir(dir: string) {
		this.dataDir = dir;
	}

	private ledgerRunTask(run: string): string | null {
		for (const t of this.ledger.values()) if (t.runIds.includes(run)) return t.id;
		return null;
	}

	// ---------------------------------------------------------------- refresh

	/**
	 * Re-read what changed: run step timings (live tasks' runs every time,
	 * finished runs once), findings files, and live tasks' handled inbox
	 * messages. Then recompute every task's time split. Never throws.
	 */
	async refresh(ledger: Map<string, LedgerTask>, meta: Map<string, TaskMeta>): Promise<void> {
		this.ledger = ledger;
		this.meta = meta;
		await this.mapRuns().catch(() => {});
		const byTask = this.runsByTask();
		await Promise.all(
			[...ledger.values()].map(async (t) => {
				const live = meta.get(t.id)?.live ?? false;
				for (const run of byTask.get(t.id) ?? []) {
					if (live || !this.timings.has(run))
						this.timings.set(run, await this.readRun(run).catch(() => null));
				}
				await this.readDecisionInputs(t, live).catch(() => {});
			})
		);
		this.recompute(byTask);
	}

	/** Map every run in the logs directory to the task whose branch it validated. */
	private async mapRuns() {
		if (!this.opts.logsDir) return;
		for (const run of await readdir(this.opts.logsDir)) {
			if (!RUN_ID.test(run) || this.runTask.get(run)) continue;
			if (this.now() - (this.runTried.get(run) ?? -Infinity) < 120) continue;
			this.runTried.set(run, this.now());
			let task: string | null = null;
			for (const step of ['rebase', 'push', 'pr']) {
				const text = await head(path.join(this.opts.logsDir, run, `${step}.log`), HEAD_BYTES);
				const m = text ? BRANCH.exec(text) : null;
				if (m) {
					task = m[1];
					break;
				}
			}
			this.runTask.set(run, task);
		}
	}

	private runsByTask(): Map<string, string[]> {
		const out = new Map<string, string[]>();
		const add = (task: string, run: string) => {
			const list = out.get(task) ?? [];
			if (!list.includes(run)) list.push(run);
			out.set(task, list);
		};
		for (const [run, task] of this.runTask) if (task) add(task, run);
		for (const t of this.ledger.values()) for (const run of t.runIds) add(t.id, run);
		return out;
	}

	/** One run's step timings from its step logs' creation and last-write times. */
	private async readRun(run: string): Promise<RunTiming | null> {
		if (!this.opts.logsDir || !RUN_ID.test(run)) return null;
		const dir = path.join(this.opts.logsDir, run);
		const steps: RunTiming['steps'] = [];
		for (const n of await readdir(dir)) {
			const step = n.endsWith('.log') ? n.slice(0, -4) : '';
			if (!STEPS.has(step)) continue;
			const st = await stat(path.join(dir, n)).catch(() => null);
			if (!st?.isFile()) continue;
			const end = Math.floor(st.mtimeMs / 1000);
			const start = st.birthtimeMs > 0 ? Math.floor(st.birthtimeMs / 1000) : end;
			steps.push({ step, startedAt: Math.min(start, end), endedAt: end });
		}
		if (!steps.length) return null;
		steps.sort((a, b) => a.startedAt - b.startedAt);
		const ci = await tail(path.join(dir, 'ci.log'), 16 * 1024);
		return { id: run, steps, noCi: !!ci && /no_ci: true|declares no CI/.test(ci) };
	}

	private async readDecisionInputs(t: LedgerTask, live: boolean) {
		const taskDir = path.join(this.dataDir, t.id);
		for (const d of pairDecisions(t.statuses)) {
			const file = d.findingsFile;
			// Only findings files inside this task's own data folder are read.
			if (!file || this.findings.has(file) || !inside(path.resolve(file), taskDir)) continue;
			const st = await stat(file).catch(() => null);
			if (!st?.isFile() || st.size > MAX_FINDINGS_BYTES) {
				this.findings.set(file, []);
				continue;
			}
			this.findings.set(file, parseFindings(await readFile(file, 'utf8').catch(() => '')));
		}
		if (!live) return;
		const dir = path.join(this.opts.homeDir, 'state', `${t.id}.inbox`, 'handled');
		const names = (await readdir(dir).catch(() => [] as string[]))
			.filter((n) => n.endsWith('.msg'))
			.sort()
			.slice(-MAX_HANDLED);
		const bodies: string[] = [];
		for (const n of names) {
			const text = await head(path.join(dir, n), 64 * 1024);
			if (text) bodies.push(text);
		}
		// Keep what was read while the task lived: cleanup removes the inbox.
		if (bodies.length) this.handled.set(t.id, bodies);
	}

	private recompute(byTask: Map<string, string[]>) {
		const now = this.now();
		const splits = new Map<string, TimeSplit>();
		for (const t of this.ledger.values()) {
			if (!t.dispatched) continue;
			const m = this.meta.get(t.id);
			const runs = (byTask.get(t.id) ?? [])
				.map((r) => this.timings.get(r))
				.filter((r): r is RunTiming => !!r);
			splits.set(
				t.id,
				splitTime(
					{
						id: t.id,
						// A promoted task's current kind, not the one it was dispatched as.
						kind: m?.kind ?? t.dispatched.kind ?? null,
						project: t.dispatched.project ?? m?.projectId ?? null,
						dispatchedAt: t.dispatched.ts,
						statuses: t.statuses,
						mergedAt: t.merged?.ts ?? null,
						cleanedUpAt: t.cleanedUpAt,
						live: m?.live ?? false,
						runs
					},
					now
				)
			);
		}
		this.splits = splits;
	}

	// ---------------------------------------------------------------- usage

	/** Read transcripts and the allowance at most once a minute (coalesced). */
	pollUsage(): Promise<void> {
		const now = this.now();
		if (now - this.usageAt < (this.opts.usageIntervalSec ?? 60)) return Promise.resolve();
		this.usageAt = now;
		this.usageRunning ??= (async () => {
			await this.usage?.poll(now).catch(() => {});
			await this.readAllowance(now).catch(() => {});
		})().finally(() => (this.usageRunning = null));
		return this.usageRunning;
	}

	private async readAllowance(now: number) {
		const r = await (this.opts.readQuota ?? (() => readQuota(this.opts.env ?? process.env)))();
		this.allowance = r.ok ? parseAllowance(r.stdout) : { state: 'unavailable', reason: r.reason };
		this.allowanceAt = now;
		if (this.allowance.state !== 'ok') return;
		for (const w of this.allowance.windows) {
			const list = [...(this.samples.get(w.id) ?? []), { at: now, percentLeft: w.percentLeft }];
			// A reset restarts the slope.
			const last = list.at(-2);
			this.samples.set(
				w.id,
				(last && w.percentLeft > last.percentLeft ? list.slice(-1) : list).slice(-SAMPLES_KEPT)
			);
		}
	}

	// ---------------------------------------------------------------- views

	split(id: string): TimeSplit | null {
		return this.splits.get(id) ?? null;
	}

	private subject(id: string): EtaSubject | null {
		const s = this.splits.get(id);
		const t = this.ledger.get(id);
		if (!s || !t?.dispatched) return null;
		return {
			split: s,
			kind: this.meta.get(id)?.kind ?? t.dispatched.kind,
			project: t.dispatched.project
		};
	}

	/** The work-time estimate for work under way; null for anything else. */
	eta(id: string): WorkEta | null {
		const subject = this.subject(id);
		if (!subject || !subject.split.ongoing) return null;
		if (subject.split.phase === 'captain') return null;
		const history = [...this.splits.keys()]
			.map((k) => this.subject(k))
			.filter((x): x is EtaSubject => !!x);
		return estimate(subject, history, this.now());
	}

	time(): TimeView {
		const tasks = [...this.splits.values()]
			.filter((s) => s.total > 0)
			.map((s) => {
				const t = this.ledger.get(s.taskId)!;
				const m = this.meta.get(s.taskId);
				return {
					...s,
					title: m?.title ?? readable(s.taskId),
					projectId: t.dispatched?.project ?? m?.projectId ?? 'other',
					kind: m?.kind ?? t.dispatched?.kind ?? null,
					startedAt: new Date(t.dispatched!.ts * 1000).toISOString()
				};
			})
			.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
		const notes: string[] = [];
		if (!this.opts.logsDir)
			notes.push('The automated review’s step timings could not be read on this machine.');
		return { schema: 'wheelhouse-time.v1', available: true, reason: null, tasks, notes };
	}

	decisions(taskId?: string): DecisionView[] {
		const out: DecisionView[] = [];
		for (const t of this.ledger.values()) {
			if (taskId && t.id !== taskId) continue;
			const m = this.meta.get(t.id);
			for (const d of pairDecisions(t.statuses)) {
				const all = d.findingsFile ? (this.findings.get(d.findingsFile) ?? []) : [];
				const raised = d.findingIds.map(
					(id) =>
						all.find((f) => f.id === id) ?? {
							id,
							severity: null,
							file: null,
							line: null,
							description: ''
						}
				);
				if (!raised.length) continue;
				const answer = fullAnswer(d.answer, this.handled.get(t.id) ?? []);
				const calls = callsFor(answer.text, raised).map((c) => ({
					question: gist(c.finding),
					detail: c.finding.description,
					file: c.finding.file ? c.finding.file.split('/').slice(-2).join('/') : null,
					serious: c.finding.severity === 'error',
					verdict: c.verdict,
					reason: c.reason
				}));
				out.push({
					id: `${d.key}-${d.askedAt}`,
					taskId: t.id,
					taskTitle: m?.title ?? readable(t.id),
					projectId: t.dispatched?.project ?? m?.projectId ?? null,
					step: d.step,
					askedAt: new Date(d.askedAt * 1000).toISOString(),
					decidedAt: new Date(d.decidedAt * 1000).toISOString(),
					verdict: overall(calls.map((c) => c.verdict)),
					calls,
					answerCut: answer.cut,
					landed: !!t.merged
				});
			}
		}
		return out.sort((a, b) => b.decidedAt.localeCompare(a.decidedAt));
	}

	decisionsView(): DecisionsView {
		return {
			schema: 'wheelhouse-decisions.v1',
			available: true,
			reason: null,
			decisions: this.decisions()
		};
	}

	headroom(): HeadroomView {
		const now = this.now();
		const a = this.allowance;
		let allowance: HeadroomView['allowance'];
		let atRisk: AllowanceWindow | null = null;
		if (!a)
			allowance = { state: 'unavailable', reason: 'Wheelhouse has not read Claude’s limits yet.' };
		else if (a.state !== 'ok') allowance = a;
		else {
			const windows = a.windows.map((w) => {
				const resets = w.resetsAt ? Date.parse(w.resetsAt) / 1000 : null;
				const out = runsOutAt(this.samples.get(w.id) ?? [], resets, now);
				// Wheelhouse's own projection gives a time; quota-axi's runway only says it will not last.
				return {
					...w,
					atRisk: out !== null || a.runwayShort.has(w.id),
					runsOutAt: out !== null ? new Date(out * 1000).toISOString() : null
				};
			});
			atRisk = windows.find((w) => w.atRisk) ?? null;
			allowance = {
				state: 'ok',
				windows,
				readAt: new Date((this.allowanceAt ?? now) * 1000).toISOString()
			};
		}
		return { schema: 'wheelhouse-headroom.v1', allowance, usage: this.usageView(now), atRisk };
	}

	private usageView(now: number): HeadroomView['usage'] {
		if (!this.usage)
			return { available: false, reason: 'Wheelhouse is not reading Claude Code’s transcripts.' };
		if (!Number.isFinite(this.usageAt))
			return { available: false, reason: 'Wheelhouse has not read Claude use yet.' };
		const groups = new Map<string, UsageShare>();
		for (const { who, fiveHour, week } of this.usage.totals(now)) {
			const [kind, id] = who.includes(':') ? (who.split(':') as [string, string]) : [who, ''];
			const key = id ? `task:${id}` : kind;
			const m = id ? this.meta.get(id) : null;
			const g = groups.get(key) ?? {
				key,
				label:
					kind === 'firstmate'
						? 'Firstmate'
						: kind === 'other'
							? 'Other Claude use'
							: (m?.title ?? readable(id)),
				sub:
					kind === 'firstmate'
						? 'Supervising, deciding and talking to you'
						: kind === 'other'
							? 'Anything else on this account'
							: (m?.projectId ?? this.ledger.get(id)?.dispatched?.project ?? ''),
				taskId: id || null,
				fiveHour: 0,
				week: 0,
				reviewShare: 0
			};
			g.fiveHour += fiveHour;
			g.week += week;
			if (kind === 'review') g.reviewShare += week;
			groups.set(key, g);
		}
		const shares = [...groups.values()].map((g) => ({
			...g,
			reviewShare: g.week ? g.reviewShare / g.week : 0
		}));
		return {
			available: true,
			source: 'Token counts in this machine’s Claude Code transcripts',
			observedAt: new Date(this.usageAt * 1000).toISOString(),
			value: { shares: shares.sort((a, b) => b.week - a.week), hourly: this.usage.hourly(now) }
		};
	}
}

/** `quota-axi --provider claude --json`, never asking for Keychain access or refreshing credentials. */
async function readQuota(env: NodeJS.ProcessEnv) {
	const r = await runBounded(
		'quota-axi',
		['--provider', 'claude', '--json', '--no-credential-refresh', '--max-age', '2m'],
		{ env, timeoutMs: 20_000, maxOutputBytes: 512 * 1024 }
	);
	// quota-axi exits non-zero when a provider needs attention, but still prints its report.
	if (r.ok || (r.kind === 'exit' && r.stdout.trim().startsWith('{')))
		return { ok: true as const, stdout: r.stdout };
	return {
		ok: false as const,
		reason:
			r.kind === 'spawn-error'
				? 'quota-axi is not installed, so Claude’s limits cannot be read.'
				: `quota-axi could not read Claude’s limits: ${r.message}`
	};
}
