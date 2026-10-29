import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { access, mkdir, open, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { runBounded } from '../firstmate/exec';
import { TASK_ID } from '../firstmate/adapter';
import { EFFORTS, MODEL, runAgent } from './agent';
import { parsePatch } from './diff';
import {
	askPrompt,
	ASK_SYSTEM,
	guidePrompt,
	GUIDE_SYSTEM,
	parseGuide,
	reviewPrompt,
	REVIEW_SYSTEM
} from './prompt';
import { taskRecords, type TaskRecord } from './records';
import type { BuildInsight } from '../../buildlog';
import type {
	Guide,
	ReviewConfig,
	ReviewEvent,
	ReviewFile,
	ReviewHunk,
	ReviewRun,
	ReviewView,
	RunKind
} from '../../prreview';
import type { DecisionView, TaskEvidence, TaskSummary } from '../../types';

/**
 * The live PR review's server side. Reads a task's pull request (its diff,
 * commits, description and the task's records) read-only, runs the review
 * agent only when the captain asks, and keeps what it wrote per PR head in
 * Wheelhouse's state directory, so reopening a PR costs nothing. Live text goes
 * out on the shared event stream as `review` events. Nothing here writes code
 * or touches the task: a change the captain wants goes to Firstmate as a note
 * from the page, like any other message.
 */

export interface ReviewAgentConfig {
	bin: string;
	model: string;
	effort: string;
	maxBudgetUsd: number;
	timeoutMs: number;
	/** Set when the agent is turned off. */
	off: string | null;
}

export interface ReviewServiceOptions {
	homeDir: string;
	/** This home's directory in Wheelhouse's state (reviews go in pr-review/); null keeps them in memory only. */
	stateDir: string | null;
	env: NodeJS.ProcessEnv;
	useGh: boolean;
	agent: ReviewAgentConfig;
	now?: () => number;
}

/** What the caller knows about the task; the build records are read only when a run needs them. */
export interface ReviewSubject {
	task: TaskSummary;
	worktree: string | null;
	files: TaskEvidence['files'];
	records: () => Promise<{ build: BuildInsight | null; decided: DecisionView[] }>;
}

interface Material {
	head: string;
	base: string;
	source: string;
	files: ReviewFile[];
	truncated: boolean;
	commits: { sha: string; subject: string; body: string }[];
	pr: { url: string; number: number | null; title: string | null; body: string | null } | null;
	at: number;
}

interface HeadState {
	guide: Guide | null;
	runs: ReviewRun[];
	at: string;
}

interface Stored {
	schema: 'wheelhouse-pr-review-store.v1';
	heads: Record<string, HeadState>;
}

export type StartResult =
	| { ok: true; run: ReviewRun | null; guide?: Guide }
	| { ok: false; status: 400 | 404 | 409 | 429 | 503; message: string };

const DIFF_BYTES = 4 * 1024 * 1024;
const MATERIAL_MS = 20_000;
const MAX_RUNNING = 2;
const KEEP_HEADS = 3;
const KEEP_RUNS = 120;
const FLUSH_MS = 200;
const MAX_QUESTION = 4000;
export const REVIEW_MODELS = ['haiku', 'sonnet', 'opus'];

const ghNumber = (url: string) => {
	const n = /\/pull\/(\d+)/.exec(url)?.[1];
	return n ? Number(n) : null;
};

export class ReviewService {
	private materials = new Map<string, Material>();
	private stores = new Map<string, Promise<Stored>>();
	private live = new Map<string, { controller: AbortController; taskId: string; head: string }>();
	private listeners = new Set<(e: ReviewEvent) => void>();
	private writes = new Map<string, Promise<void>>();
	private binChecked: { at: number; problem: string | null } | null = null;
	private now: () => number;

	constructor(private opts: ReviewServiceOptions) {
		this.now = opts.now ?? Date.now;
	}

	subscribe(fn: (e: ReviewEvent) => void): () => void {
		this.listeners.add(fn);
		return () => this.listeners.delete(fn);
	}

	private emit(e: ReviewEvent) {
		for (const fn of this.listeners) {
			try {
				fn(e);
			} catch {
				// a broken subscriber must not stop a run
			}
		}
	}

	runningCount(): number {
		return this.live.size;
	}

	/** The task of each run in progress. */
	runningTasks(): string[] {
		return [...this.live.values()].map((l) => l.taskId);
	}

	// ------------------------------------------------------------ view

	async config(): Promise<ReviewConfig> {
		const a = this.opts.agent;
		const models = REVIEW_MODELS.includes(a.model) ? REVIEW_MODELS : [a.model, ...REVIEW_MODELS];
		return {
			model: a.model,
			effort: a.effort,
			models,
			efforts: EFFORTS.slice(0, 3),
			unavailable: a.off ?? (await this.binProblem())
		};
	}

	async view(s: ReviewSubject): Promise<ReviewView> {
		const m = await this.material(s);
		if (!m.ok)
			return {
				schema: 'wheelhouse-pr-review.v1',
				available: false,
				taskId: s.task.id,
				reason: m.reason
			};
		const store = await this.store(s.task.id);
		const here = store.heads[m.value.head] ?? null;
		const older = here?.guide
			? null
			: Object.entries(store.heads)
					.filter(([h, st]) => h !== m.value.head && st.guide)
					.sort((a, b) => b[1].at.localeCompare(a[1].at))[0];
		const files = here?.guide ? markUnseen(m.value.files, here.guide) : m.value.files;
		return {
			schema: 'wheelhouse-pr-review.v1',
			available: true,
			taskId: s.task.id,
			pr: m.value.pr
				? { url: m.value.pr.url, number: m.value.pr.number, title: m.value.pr.title }
				: null,
			head: m.value.head,
			base: m.value.base,
			source: m.value.source,
			files,
			truncated: m.value.truncated,
			guide: here?.guide ?? null,
			staleGuide: older ? { head: older[0], at: older[1].guide!.at } : null,
			runs: here?.runs ?? [],
			config: await this.config()
		};
	}

	// ------------------------------------------------------------ runs

	async startGuide(
		s: ReviewSubject,
		o: { force?: boolean; model?: string; effort?: string }
	): Promise<StartResult> {
		const ready = await this.ready(s, o);
		if (!ready.ok) return ready;
		const { m, model, effort } = ready;
		const store = await this.store(s.task.id);
		const here = this.head(store, m.head);
		if (here.guide && !o.force) return { ok: true, run: null, guide: here.guide };
		const going = here.runs.find((r) => r.kind === 'guide' && r.status === 'running');
		if (going) return { ok: true, run: going };
		const run = this.newRun('guide', null, null, model, effort);
		let records: TaskRecord[] = [];
		let shown = new Set<string>();
		return this.launch(
			s.task.id,
			m.head,
			here,
			run,
			GUIDE_SYSTEM,
			async () => {
				records = await this.recordsFor(s, m);
				const g = guidePrompt({
					title: s.task.title,
					prUrl: m.pr?.url ?? null,
					records,
					files: m.files
				});
				shown = g.shown;
				return g.prompt;
			},
			async (r) => {
				const parsed = parseGuide(r.text, shown, new Set(records.map((x) => x.label)));
				if (!parsed) {
					r.status = 'failed';
					r.error =
						'The review agent’s guide could not be read. Try again, or ask a question instead.';
					return;
				}
				const guide: Guide = {
					runId: r.id,
					head: m.head,
					at: r.finishedAt!,
					summary: parsed.summary,
					items: parsed.items,
					unseen: m.files
						.flatMap((f) => f.hunks)
						.filter((h) => !h.boilerplate && !shown.has(h.id))
						.map((h) => h.id),
					records: records.map(({ label, name, excerpt }) => ({ label, name, excerpt })),
					usage: r.usage,
					model: r.usage?.model ?? r.model,
					effort: r.effort
				};
				this.head(await this.store(s.task.id), m.head).guide = guide;
				this.emit({ taskId: s.task.id, head: m.head, type: 'guide', guide });
			}
		);
	}

	async ask(
		s: ReviewSubject,
		o: { question: string; hunk?: string | null; model?: string; effort?: string }
	): Promise<StartResult> {
		const question = (o.question ?? '').trim();
		if (!question) return { ok: false, status: 400, message: 'Write a question first.' };
		if (question.length > MAX_QUESTION)
			return {
				ok: false,
				status: 400,
				message: `Keep a question under ${MAX_QUESTION} characters.`
			};
		const ready = await this.ready(s, o);
		if (!ready.ok) return ready;
		const { m, model, effort } = ready;
		const hunk = this.hunk(m, o.hunk);
		if (hunk === undefined)
			return {
				ok: false,
				status: 404,
				message: 'That hunk is not in this version of the pull request.'
			};
		const store = await this.store(s.task.id);
		const here = this.head(store, m.head);
		const earlier = here.runs.filter((r) => r.hunk === (hunk?.id ?? null));
		const run = this.newRun('ask', hunk?.id ?? null, question, model, effort);
		return this.launch(s.task.id, m.head, here, run, ASK_SYSTEM, async () =>
			askPrompt({
				title: s.task.title,
				prUrl: m.pr?.url ?? null,
				records: await this.recordsFor(s, m),
				files: m.files,
				hunk,
				question,
				earlier,
				guideSummary: here.guide?.summary ?? null
			})
		);
	}

	async review(
		s: ReviewSubject,
		o: { hunk?: string | null; model?: string; effort?: string }
	): Promise<StartResult> {
		const ready = await this.ready(s, o);
		if (!ready.ok) return ready;
		const { m, model, effort } = ready;
		const hunk = this.hunk(m, o.hunk);
		if (hunk === undefined)
			return {
				ok: false,
				status: 404,
				message: 'That hunk is not in this version of the pull request.'
			};
		const here = this.head(await this.store(s.task.id), m.head);
		const run = this.newRun('review', hunk?.id ?? null, null, model, effort);
		return this.launch(s.task.id, m.head, here, run, REVIEW_SYSTEM, async () =>
			reviewPrompt({
				title: s.task.title,
				prUrl: m.pr?.url ?? null,
				records: await this.recordsFor(s, m),
				files: m.files,
				hunk
			})
		);
	}

	/** Stop a run of this task's; false when it is not running. */
	stop(taskId: string, runId: string): boolean {
		const l = this.live.get(runId);
		if (!l || l.taskId !== taskId) return false;
		l.controller.abort();
		return true;
	}

	/** Stop every run (Wheelhouse is shutting down). */
	stopAll(): void {
		for (const l of this.live.values()) l.controller.abort();
	}

	private hunk(m: Material, id: string | null | undefined): ReviewHunk | null | undefined {
		if (!id) return null;
		return m.files.flatMap((f) => f.hunks).find((h) => h.id === id);
	}

	private async ready(
		s: ReviewSubject,
		o: { model?: string; effort?: string }
	): Promise<
		| { ok: true; m: Material; model: string; effort: string }
		| { ok: false; status: 400 | 404 | 503; message: string }
	> {
		const cfg = await this.config();
		if (cfg.unavailable) return { ok: false, status: 503, message: cfg.unavailable };
		const model = o.model || cfg.model;
		const effort = o.effort || cfg.effort;
		if (!MODEL.test(model) || !cfg.models.includes(model))
			return {
				ok: false,
				status: 400,
				message: `Pick one of the offered models (${cfg.models.join(', ')}).`
			};
		if (!EFFORTS.includes(effort))
			return { ok: false, status: 400, message: `Effort is one of ${EFFORTS.join(', ')}.` };
		const m = await this.material(s, true);
		if (!m.ok) return { ok: false, status: 404, message: m.reason };
		return { ok: true, m: m.value, model, effort };
	}

	private newRun(
		kind: RunKind,
		hunk: string | null,
		question: string | null,
		model: string,
		effort: string
	): ReviewRun {
		return {
			id: `r-${randomUUID()}`,
			kind,
			hunk,
			question,
			status: 'running',
			text: '',
			error: null,
			startedAt: new Date(this.now()).toISOString(),
			finishedAt: null,
			model,
			effort,
			usage: null
		};
	}

	/** Start a run, registered before anything awaits so concurrent requests count it; the prompt is built after, inside the run. */
	private launch(
		taskId: string,
		head: string,
		here: HeadState,
		run: ReviewRun,
		system: string,
		prepare: () => Promise<string>,
		after?: (run: ReviewRun) => Promise<void>
	): StartResult {
		if (this.live.size >= MAX_RUNNING)
			return {
				ok: false,
				status: 429,
				message: `The review agent is already answering ${MAX_RUNNING} requests. Wait for one to finish.`
			};
		here.runs.push(run);
		if (here.runs.length > KEEP_RUNS) here.runs.splice(0, here.runs.length - KEEP_RUNS);
		const controller = new AbortController();
		this.live.set(run.id, { controller, taskId, head });
		this.emit({ taskId, head, type: 'run', run: { ...run } });
		let timer: ReturnType<typeof setTimeout> | null = null;
		const flush = () => {
			timer = null;
			this.emit({ taskId, head, type: 'text', runId: run.id, text: run.text });
		};
		const a = this.opts.agent;
		void Promise.all([prepare(), this.cwd()])
			.then(([prompt, cwd]) =>
				runAgent(
					prompt,
					system,
					{
						bin: a.bin,
						model: run.model,
						effort: run.effort,
						maxBudgetUsd: a.maxBudgetUsd,
						timeoutMs: a.timeoutMs,
						cwd,
						env: this.opts.env
					},
					{
						signal: controller.signal,
						onText: (d) => {
							run.text += d;
							timer ??= setTimeout(flush, FLUSH_MS);
						}
					}
				)
			)
			.then(async (res) => {
				if (timer) clearTimeout(timer);
				run.text = res.text;
				run.usage = res.usage;
				run.finishedAt = new Date(this.now()).toISOString();
				if (res.ok) run.status = 'done';
				else {
					run.status = res.stopped ? 'stopped' : 'failed';
					run.error = res.stopped ? null : res.error;
				}
				if (res.ok && after) await after(run);
			})
			.catch((e) => {
				run.status = 'failed';
				console.warn(`Wheelhouse's review agent run ${run.id} failed: ${(e as Error).message}`);
				run.error = 'The review agent could not answer this request. Try again.';
				run.finishedAt = new Date(this.now()).toISOString();
			})
			.finally(async () => {
				this.live.delete(run.id);
				this.emit({ taskId, head, type: 'run', run: { ...run } });
				await this.save(taskId);
			});
		return { ok: true, run: { ...run } };
	}

	private async cwd(): Promise<string> {
		const dir = this.opts.stateDir
			? path.join(this.opts.stateDir, 'pr-review', 'agent')
			: process.cwd();
		await mkdir(dir, { recursive: true }).catch(() => {});
		return dir;
	}

	/** Whether the claude binary can be found (checked at most once a minute). */
	private async binProblem(): Promise<string | null> {
		if (this.binChecked && this.now() - this.binChecked.at < 60_000) return this.binChecked.problem;
		const bin = this.opts.agent.bin;
		const dirs = bin.includes('/')
			? ['']
			: (this.opts.env.PATH ?? '').split(path.delimiter).filter(Boolean);
		let found = false;
		for (const d of dirs) {
			const f = d ? path.join(d, bin) : bin;
			if (
				await access(f, constants.X_OK).then(
					() => true,
					() => false
				)
			) {
				found = true;
				break;
			}
		}
		const problem = found
			? null
			: `The review agent needs the Claude Code CLI (${bin}), which is not on this machine’s PATH.`;
		this.binChecked = { at: this.now(), problem };
		return problem;
	}

	// ------------------------------------------------------------ the pull request

	private async recordsFor(s: ReviewSubject, m: Material): Promise<TaskRecord[]> {
		const [{ build, decided }, brief] = await Promise.all([
			s.records().catch(() => ({ build: null, decided: [] })),
			this.brief(s.task.id).catch(() => null)
		]);
		return taskRecords({ brief, commits: m.commits, prBody: m.pr?.body ?? null, build, decided });
	}

	/** The task's brief, data/<id>/brief.md (else launch-brief.md), bounded. */
	private async brief(id: string): Promise<string | null> {
		if (!TASK_ID.test(id)) return null;
		for (const name of ['brief.md', 'launch-brief.md']) {
			const text = await readBounded(path.join(this.opts.homeDir, 'data', id, name), 64 * 1024);
			if (text !== null) return text;
		}
		return null;
	}

	private async material(
		s: ReviewSubject,
		fresh = false
	): Promise<{ ok: true; value: Material } | { ok: false; reason: string }> {
		const hit = this.materials.get(s.task.id);
		if (hit && this.now() - hit.at < (fresh ? 5000 : MATERIAL_MS)) return { ok: true, value: hit };
		const prUrl = s.task.pr?.url ?? null;
		const pr = prUrl ? await this.prMeta(prUrl) : null;
		let m: Material | null = null;
		if (s.worktree) m = await this.fromWorktree(s, pr);
		if (!m && prUrl && this.opts.useGh) m = await this.fromGh(prUrl, pr);
		if (!m) {
			return {
				ok: false,
				reason: prUrl
					? 'The pull request’s changes cannot be read: its worktree is gone and GitHub did not answer.'
					: 'This task has no pull request or committed changes to review yet.'
			};
		}
		this.materials.set(s.task.id, m);
		if (this.materials.size > 100) this.materials.delete(this.materials.keys().next().value!);
		return { ok: true, value: m };
	}

	private git(worktree: string, args: string[], max = 1024 * 1024) {
		return runBounded('git', ['--no-optional-locks', '-C', worktree, ...args], {
			env: { ...this.opts.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' },
			timeoutMs: 15_000,
			maxOutputBytes: max
		});
	}

	private async fromWorktree(s: ReviewSubject, pr: Material['pr']): Promise<Material | null> {
		const wt = s.worktree!;
		const head = await this.git(wt, ['rev-parse', 'HEAD']);
		if (!head.ok || !head.stdout.trim()) return null;
		let base = s.files.available ? s.files.value.base : null;
		let mergeBase = s.files.available ? s.files.value.mergeBase : null;
		if (!base || !mergeBase) {
			for (const c of ['origin/main', 'origin/master', 'main', 'master']) {
				const mb = await this.git(wt, ['merge-base', 'HEAD', c]);
				if (mb.ok && mb.stdout.trim()) {
					base = c;
					mergeBase = mb.stdout.trim();
					break;
				}
			}
		}
		if (!base || !mergeBase) return null;
		const [diff, log] = await Promise.all([
			this.git(
				wt,
				['diff', '--no-color', '--no-ext-diff', '--no-textconv', '-M', mergeBase, 'HEAD'],
				DIFF_BYTES
			),
			this.git(wt, ['log', '--no-color', '--format=%H%x1f%s%x1f%b%x1e', `${mergeBase}..HEAD`])
		]);
		const cut = !diff.ok && diff.kind === 'output-limit';
		if (!diff.ok && !cut) return null;
		const files = parsePatch(cut ? dropLastFile(diff.stdout) : diff.stdout);
		if (!files.length) return null;
		return {
			head: head.stdout.trim(),
			base,
			source: `the committed changes on ${s.task.branch ?? 'the task branch'} against ${base}, in the task worktree`,
			files,
			truncated: cut,
			commits: log.ok ? parseLog(log.stdout) : [],
			pr,
			at: this.now()
		};
	}

	private gh(args: string[], max = 2 * 1024 * 1024) {
		return runBounded('gh', args, {
			env: { ...this.opts.env, GH_PROMPT_DISABLED: '1' },
			timeoutMs: 15_000,
			maxOutputBytes: max
		});
	}

	private prMetaCache = new Map<string, { at: number; value: Promise<Material['pr']> }>();

	/** The pull request's title and description (`gh pr view`, kept for a minute). */
	private prMeta(url: string): Promise<Material['pr']> {
		const bare = { url, number: ghNumber(url), title: null, body: null };
		if (!this.opts.useGh || !/^https:\/\/\S+\/pull\/\d+/.test(url)) return Promise.resolve(bare);
		const hit = this.prMetaCache.get(url);
		if (hit && this.now() - hit.at < 60_000) return hit.value;
		const value = this.gh(['pr', 'view', url, '--json', 'title,body,number']).then((r) => {
			if (!r.ok) return bare;
			try {
				const v = JSON.parse(r.stdout);
				return {
					url,
					number: typeof v.number === 'number' ? v.number : bare.number,
					title: typeof v.title === 'string' ? v.title : null,
					body: typeof v.body === 'string' ? v.body : null
				};
			} catch {
				return bare;
			}
		});
		this.prMetaCache.set(url, { at: this.now(), value });
		return value;
	}

	private async fromGh(url: string, pr: Material['pr']): Promise<Material | null> {
		if (!/^https:\/\/\S+\/pull\/\d+/.test(url)) return null;
		const [meta, diff] = await Promise.all([
			this.gh(['pr', 'view', url, '--json', 'headRefOid,baseRefName,commits']),
			this.gh(['pr', 'diff', url], DIFF_BYTES)
		]);
		if (!meta.ok) return null;
		const cut = !diff.ok && diff.kind === 'output-limit';
		if (!diff.ok && !cut) return null;
		let v: { headRefOid?: unknown; baseRefName?: unknown; commits?: unknown };
		try {
			v = JSON.parse(meta.stdout);
		} catch {
			return null;
		}
		if (typeof v.headRefOid !== 'string') return null;
		const commits = Array.isArray(v.commits)
			? v.commits.map((c: { oid?: unknown; messageHeadline?: unknown; messageBody?: unknown }) => ({
					sha: typeof c.oid === 'string' ? c.oid : '',
					subject: typeof c.messageHeadline === 'string' ? c.messageHeadline : '',
					body: typeof c.messageBody === 'string' ? c.messageBody : ''
				}))
			: [];
		const files = parsePatch(cut ? dropLastFile(diff.stdout) : diff.stdout);
		if (!files.length) return null;
		const base = typeof v.baseRefName === 'string' ? v.baseRefName : 'the base branch';
		return {
			head: v.headRefOid,
			base,
			source: `the pull request on GitHub (gh pr diff), against ${base}`,
			files,
			truncated: cut,
			commits,
			pr,
			at: this.now()
		};
	}

	// ------------------------------------------------------------ the store

	private head(store: Stored, head: string): HeadState {
		let h = store.heads[head];
		if (!h) {
			h = { guide: null, runs: [], at: new Date(this.now()).toISOString() };
			store.heads[head] = h;
			const keys = Object.entries(store.heads).sort((a, b) => b[1].at.localeCompare(a[1].at));
			for (const [k] of keys.slice(KEEP_HEADS)) delete store.heads[k];
		}
		return h;
	}

	private file(taskId: string): string | null {
		if (!this.opts.stateDir || !TASK_ID.test(taskId)) return null;
		return path.join(this.opts.stateDir, 'pr-review', `${taskId}.json`);
	}

	private store(taskId: string): Promise<Stored> {
		let s = this.stores.get(taskId);
		if (!s) {
			s = this.load(taskId);
			this.stores.set(taskId, s);
		}
		return s;
	}

	private async load(taskId: string): Promise<Stored> {
		let s: Stored = { schema: 'wheelhouse-pr-review-store.v1', heads: {} };
		const f = this.file(taskId);
		if (f) {
			const text = await readBounded(f, 16 * 1024 * 1024).catch(() => null);
			try {
				const v = text ? JSON.parse(text) : null;
				if (v?.schema === s.schema && v.heads && typeof v.heads === 'object') s = v as Stored;
			} catch {
				// unreadable: start again
			}
		}
		// A run left running when Wheelhouse stopped never finished.
		for (const h of Object.values(s.heads))
			for (const r of h.runs)
				if (r.status === 'running' && !this.live.has(r.id)) {
					r.status = 'failed';
					r.error = 'Wheelhouse stopped before the review agent finished.';
				}
		return s;
	}

	private save(taskId: string): Promise<void> {
		const f = this.file(taskId);
		const s = this.stores.get(taskId);
		if (!f || !s) return Promise.resolve();
		const prev = this.writes.get(taskId) ?? Promise.resolve();
		const next = prev
			.then(async () => {
				await mkdir(path.dirname(f), { recursive: true });
				const tmp = `${f}.${process.pid}.tmp`;
				await writeFile(tmp, JSON.stringify(await s));
				await rename(tmp, f);
			})
			.catch((e) => {
				console.warn(
					`Wheelhouse could not save the PR review for ${taskId}: ${(e as Error).message}`
				);
			});
		this.writes.set(taskId, next);
		return next;
	}
}

/** Mark the hunks the guide's agent was not shown (the diff was too large). */
function markUnseen(files: ReviewFile[], guide: Guide): ReviewFile[] {
	const unseen = new Set(guide.unseen);
	return files.map((f) => ({
		...f,
		hunks: f.hunks.map((h) => ({ ...h, unseen: unseen.has(h.id) }))
	}));
}

/** A diff cut at the byte limit: drop its last, partial file. */
function dropLastFile(text: string): string {
	const at = text.lastIndexOf('\ndiff --git ');
	return at > 0 ? text.slice(0, at + 1) : text;
}

export function parseLog(out: string): { sha: string; subject: string; body: string }[] {
	return out
		.split('\x1e')
		.map((r) => r.replace(/^\n/, ''))
		.filter((r) => r.trim())
		.map((r) => {
			const [sha, subject, body] = r.split('\x1f');
			return { sha: sha?.trim() ?? '', subject: subject ?? '', body: (body ?? '').trim() };
		})
		.filter((c) => c.sha);
}

async function readBounded(file: string, max: number): Promise<string | null> {
	const st = await stat(file).catch(() => null);
	if (!st?.isFile()) return null;
	const fh = await open(file, 'r').catch(() => null);
	if (!fh) return null;
	try {
		const len = Math.min(st.size, max);
		const buf = Buffer.alloc(len);
		const { bytesRead } = await fh.read(buf, 0, len, 0);
		return buf.subarray(0, bytesRead).toString('utf8');
	} finally {
		await fh.close();
	}
}
