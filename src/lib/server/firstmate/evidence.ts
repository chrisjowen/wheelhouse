import { open, readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { runBounded } from './exec';
import { prNumber, type PrFeedback } from './model';
import { TASK_ID } from './adapter';
import type { SnapshotTask } from './contracts';
import type {
	Available,
	Check,
	FileChange,
	FileDiff,
	Pipeline,
	TaskEvidence,
	TaskSummary,
	Thumb
} from '../../types';

/**
 * Read-only evidence for a task, derived from records Firstmate keeps:
 * - changed files: `git diff` in the task worktree Firstmate recorded;
 * - PR state and checks: Firstmate's cached forge observation in
 *   data/<id>/contributions.json, else `gh pr view` on the recorded PR URL;
 * - report: data/<id>/report.md;
 * - screenshots: image files under data/<id>/screenshots/ or data/<id>/;
 * - screenshots also come from the no-mistakes evidence folder of the task's
 *   validation runs;
 * - CI readiness of a run still monitoring its PR: the latest checks marker in
 *   that run's no-mistakes ci step log (~/.no-mistakes/logs/<run>/ci.log);
 * - the current step of an active validation run: the newest step log in
 *   ~/.no-mistakes/logs/<run>/, and its fix round from that log's tail;
 * - one file's diff: `git diff` of that file against the merge base, only for
 *   a path the changed-files list names.
 * Preview URLs come from the fleet ledger (model.ts); deployments are not
 * recorded by Firstmate at all.
 * Every read is bounded and cached briefly so an open task page does not
 * re-run commands on every refresh.
 */

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);
const MAX_FILES = 300;
const SCREENSHOT_MAX = 24;
export const ARTIFACT_NAME =
	/^(?:screenshots\/|nm\/[0-9A-Z]{26}\/)?[A-Za-z0-9][A-Za-z0-9._ -]{0,200}$/;
const NM_FILE = /^nm-([0-9A-Z]{26})-/;

interface CacheEntry<T> {
	at: number;
	value: Promise<T>;
}

class TtlCache<T> {
	private entries = new Map<string, CacheEntry<T>>();
	constructor(
		private ttlMs: number,
		private now: () => number
	) {}
	get(key: string, load: () => Promise<T>): Promise<T> {
		const hit = this.entries.get(key);
		if (hit && this.now() - hit.at < this.ttlMs) return hit.value;
		const value = load();
		this.entries.set(key, { at: this.now(), value });
		if (this.entries.size > 500) this.entries.delete(this.entries.keys().next().value!);
		return value;
	}
}

export interface EvidenceOptions {
	dataDir: string;
	env?: NodeJS.ProcessEnv;
	now?: () => number;
	/** Run `gh` for PRs without a cached Firstmate observation. */
	useGh?: boolean;
	/** no-mistakes evidence directory (default ~/.no-mistakes/evidence); null disables it. */
	evidenceDir?: string | null;
	/** no-mistakes run log directory (default ~/.no-mistakes/logs); null disables it. */
	logsDir?: string | null;
}

/**
 * What a no-mistakes CI monitor last logged about a PR's checks: green (all
 * passed, or the repository declares no CI), not-ready (running, failed or
 * not reported yet), or unknown (no log or no marker).
 */
export type CiChecks = 'green' | 'not-ready' | 'unknown';

const CI_MARKER =
	/CI checks passed|no CI checks reported - still monitoring|declares no CI \(no_ci: true\)|no CI checks reported yet|checks failed|issues detected|CI checks running/g;
const CI_LOG_MAX_BYTES = 512 * 1024;
const STEP_LOG_MAX_BYTES = 64 * 1024;
const RUN_ID = /^[0-9A-Z]{26}$/;
/** The largest diff Wheelhouse reads for one file, and the most lines it returns. */
export const FILE_DIFF_MAX_BYTES = 512 * 1024;
export const FILE_DIFF_MAX_LINES = 2000;

export const WORKTREE_GONE = 'The task’s worktree is gone, so its changes cannot be read any more.';

/** no-mistakes pipeline steps, in order, with their plain labels. */
const STEPS: [key: string, label: string][] = [
	['intent', 'Intent'],
	['rebase', 'Rebase'],
	['review', 'Review'],
	['test', 'Tests'],
	['document', 'Docs'],
	['lint', 'Lint'],
	['push', 'Push'],
	['pr', 'Pull request'],
	['ci', 'CI']
];
const STEP_LABEL = new Map(STEPS);
const STEP_ORDER = new Map(STEPS.map(([k], i) => [k, i]));

/**
 * The fix round a step log shows under way: the latest "fix round starting
 * after round N", unless the log has moved on since (fixes committed, or the
 * step re-running).
 */
export function fixRoundFromLog(log: string): number | null {
	const last = [...log.matchAll(/fix round starting after round (\d+)/g)].at(-1);
	if (!last || last.index === undefined) return null;
	if (/committed agent fixes|^reviewing changes/m.test(log.slice(last.index))) return null;
	return Number(last[1]);
}

/** The last `max` bytes of a file as text, or null when it cannot be read. */
async function readTail(file: string, max: number): Promise<string | null> {
	try {
		const st = await stat(file);
		const fh = await open(file, 'r');
		try {
			const length = Math.min(st.size, max);
			const buf = Buffer.alloc(length);
			const { bytesRead } = await fh.read(buf, 0, length, st.size - length);
			return buf.subarray(0, bytesRead).toString('utf8');
		} finally {
			await fh.close();
		}
	} catch {
		return null;
	}
}

/**
 * The CI state a ci step log reports now: its most recent recognised marker
 * (the log is append-only). Mirrors Firstmate's nm_ci_checks_state, and also
 * reads the no_ci marker no-mistakes writes for repositories without CI.
 */
export function ciChecksFromLog(log: string): CiChecks {
	const last = [...log.matchAll(CI_MARKER)].at(-1)?.[0];
	if (!last) return 'unknown';
	return /checks passed|still monitoring|no_ci/.test(last) ? 'green' : 'not-ready';
}

export interface Screenshot {
	name: string;
	file: string;
	modifiedAt: string;
}

const iso = (ms: number) => new Date(ms).toISOString();

export class EvidenceReader {
	private dataDir: string;
	private env: NodeJS.ProcessEnv;
	private now: () => number;
	private useGh: boolean;
	private evidenceDir: string | null;
	private logsDir: string | null;
	private diffs: TtlCache<TaskEvidence['files']>;
	private fileDiffs: TtlCache<FileDiff>;
	private pipelines: TtlCache<Pipeline | null>;
	private prs: TtlCache<TaskEvidence['pr']>;
	private feedback: TtlCache<PrFeedback | null>;
	private shots: TtlCache<Screenshot[]>;

	constructor(opts: EvidenceOptions) {
		this.dataDir = opts.dataDir;
		this.env = opts.env ?? process.env;
		this.now = opts.now ?? Date.now;
		this.useGh = opts.useGh ?? true;
		this.evidenceDir =
			opts.evidenceDir === undefined
				? path.join(this.env.HOME ?? '', '.no-mistakes', 'evidence')
				: opts.evidenceDir;
		this.logsDir =
			opts.logsDir === undefined
				? path.join(this.env.HOME ?? '', '.no-mistakes', 'logs')
				: opts.logsDir;
		this.diffs = new TtlCache(30_000, this.now);
		this.fileDiffs = new TtlCache(15_000, this.now);
		this.pipelines = new TtlCache(5_000, this.now);
		this.prs = new TtlCache(60_000, this.now);
		this.feedback = new TtlCache(60_000, this.now);
		this.shots = new TtlCache(15_000, this.now);
	}

	setDataDir(dir: string) {
		this.dataDir = dir;
	}

	private taskDir(id: string): string | null {
		return TASK_ID.test(id) ? path.join(this.dataDir, id) : null;
	}

	/** no-mistakes run ids for a task: from ledger decision keys and data/<id>/nm-<run>-* files. */
	private async runIds(id: string, known: readonly string[]): Promise<string[]> {
		const ids = new Set(known);
		const dir = this.taskDir(id);
		if (dir) {
			try {
				for (const n of await readdir(dir)) {
					const m = NM_FILE.exec(n);
					if (m) ids.add(m[1]);
				}
			} catch {
				// no data folder
			}
		}
		return [...ids];
	}

	/**
	 * Screenshots for this task, newest first: image files the worker saved under
	 * data/<id>/screenshots/ or data/<id>/, then the no-mistakes test-step
	 * evidence for the task's validation runs.
	 */
	screenshots(id: string, knownRunIds: readonly string[] = []): Promise<Screenshot[]> {
		const dir = this.taskDir(id);
		if (!dir) return Promise.resolve([]);
		return this.shots.get(`${id} ${knownRunIds.join(',')}`, async () => {
			const found: Screenshot[] = [];
			const scan = async (d: string, prefix: string) => {
				let names: string[];
				try {
					names = await readdir(d);
				} catch {
					return;
				}
				for (const n of names) {
					if (!IMAGE_EXT.has(path.extname(n).toLowerCase()) || n.startsWith('.')) continue;
					const name = `${prefix}${n}`;
					if (!ARTIFACT_NAME.test(name)) continue;
					try {
						const st = await stat(path.join(d, n));
						if (st.isFile())
							found.push({ name, file: path.join(d, n), modifiedAt: iso(st.mtimeMs) });
					} catch {
						// vanished between readdir and stat
					}
				}
			};
			await scan(path.join(dir, 'screenshots'), 'screenshots/');
			await scan(dir, '');
			const worker = found.length;
			if (this.evidenceDir) {
				for (const run of await this.runIds(id, knownRunIds)) {
					await scan(path.join(this.evidenceDir, run), `nm/${run}/`);
				}
			}
			const own = found.slice(0, worker).sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
			const runs = found.slice(worker).sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
			return [...own, ...runs].slice(0, SCREENSHOT_MAX);
		});
	}

	/** The CI state the no-mistakes ci step log of a run reports, bounded to its tail. */
	async ciChecks(runId: string | null): Promise<CiChecks> {
		if (!runId || !RUN_ID.test(runId) || !this.logsDir) return 'unknown';
		const log = await readTail(path.join(this.logsDir, runId, 'ci.log'), CI_LOG_MAX_BYTES);
		return log === null ? 'unknown' : ciChecksFromLog(log);
	}

	/**
	 * Where an active validation run is: its newest step log names the step,
	 * the log's creation time (else the previous step's last write) when it
	 * started, and its tail any fix round under way. Null when unreadable.
	 */
	pipeline(runId: string | null): Promise<Pipeline | null> {
		if (!runId || !RUN_ID.test(runId) || !this.logsDir) return Promise.resolve(null);
		const dir = path.join(this.logsDir, runId);
		return this.pipelines.get(runId, () => readPipeline(dir).catch(() => null));
	}

	/** Resolve an artifact name to a file only if it is one of the listed screenshots. */
	async artifactFile(
		id: string,
		name: string,
		knownRunIds: readonly string[] = []
	): Promise<string | null> {
		if (!ARTIFACT_NAME.test(name)) return null;
		const shots = await this.screenshots(id, knownRunIds);
		return shots.find((s) => s.name === name)?.file ?? null;
	}

	/** Files changed in the task worktree relative to its base branch (incl. uncommitted). */
	diff(worktree: string | null) {
		if (!worktree || !path.isAbsolute(worktree)) {
			return Promise.resolve<Available<never>>({
				available: false,
				reason: 'Firstmate has no worktree recorded for this task.'
			});
		}
		return this.diffs.get(worktree, () => readDiff(worktree, this.env));
	}

	/**
	 * One file's unified diff against the merge base of the task's changes.
	 * Only a path the changed-files list names is read, so the request can
	 * never name an arbitrary file.
	 */
	async fileDiff(worktree: string | null, file: string): Promise<FileDiff> {
		const present = worktree
			? await stat(worktree).then(
					(st) => st.isDirectory(),
					() => false
				)
			: false;
		if (!present) return { available: false, reason: WORKTREE_GONE };
		const list = await this.diff(worktree);
		if (!list.available) return { available: false, reason: list.reason };
		const entry = list.value.files.find((f) => f.path === file);
		if (!entry) {
			return {
				available: false,
				reason: 'That file is not in this task’s list of changed files.'
			};
		}
		const { mergeBase, base } = list.value;
		return this.fileDiffs.get(`${worktree} ${mergeBase} ${entry.status} ${file}`, () =>
			readFileDiff(worktree!, mergeBase, base, entry, this.env)
		);
	}

	/** PR state and checks for a recorded PR URL. */
	pr(id: string, url: string | null): Promise<TaskEvidence['pr']> {
		if (!url) {
			return Promise.resolve({
				available: false,
				reason: 'Firstmate has no pull request recorded for this task yet.'
			});
		}
		return this.prs.get(`${id} ${url}`, async () => {
			const cached = await this.contributions(id, url);
			if (cached) return cached;
			if (!this.useGh) {
				return { available: false, reason: 'No cached PR observation from Firstmate.' };
			}
			return readGhPr(url, this.env);
		});
	}

	/**
	 * Review feedback and the head commit of a GitHub pull request, through
	 * read-only `gh api` GETs (cached for a minute); null when it cannot be read.
	 */
	prFeedback(url: string): Promise<PrFeedback | null> {
		const target = githubPull(url);
		if (!target || !this.useGh) return Promise.resolve(null);
		return this.feedback.get(url, () => readPrFeedback(target, this.env));
	}

	private async contributions(id: string, url: string): Promise<TaskEvidence['pr'] | null> {
		const dir = this.taskDir(id);
		if (!dir) return null;
		let raw: string;
		try {
			raw = await readFile(path.join(dir, 'contributions.json'), 'utf8');
		} catch {
			return null;
		}
		try {
			const doc = JSON.parse(raw);
			if (doc?.schema !== 'fm-contributions.v1' || !Array.isArray(doc.records)) return null;
			const rec = doc.records.find(
				(r: { url?: string; kind?: string }) => r?.url === url && r?.kind === 'pr'
			);
			const o = rec?.observation;
			if (!o || typeof o !== 'object') return null;
			const checks: Check[] = Array.isArray(o.checks)
				? o.checks.map((c: { name?: string; status?: string; conclusion?: string }) => ({
						name: String(c?.name ?? 'check'),
						state: checkState(c?.status, c?.conclusion)
					}))
				: [];
			return {
				available: true,
				source: 'Firstmate’s cached PR observation (contributions.json)',
				observedAt: typeof rec.checked_at === 'string' ? rec.checked_at : null,
				value: {
					url,
					number: prNumber(url),
					state: typeof o.state === 'string' ? o.state : null,
					draft: typeof o.draft === 'boolean' ? o.draft : null,
					reviewDecision: o.review_decision ? String(o.review_decision) : null,
					checks
				}
			};
		} catch {
			return null;
		}
	}

	/** The first paragraph of data/<id>/report.md. */
	async report(id: string, reportPath: string | null): Promise<TaskEvidence['report']> {
		const dir = this.taskDir(id);
		const file =
			reportPath && path.isAbsolute(reportPath) ? reportPath : dir && path.join(dir, 'report.md');
		if (!file) return { available: false, reason: 'No report.' };
		try {
			const st = await stat(file);
			const fh = await readFile(file, 'utf8');
			return {
				available: true,
				source: 'report.md in the task’s data folder',
				observedAt: iso(st.mtimeMs),
				value: { path: path.relative(path.dirname(this.dataDir), file), excerpt: excerpt(fh) }
			};
		} catch {
			return { available: false, reason: 'The worker has not written a report.' };
		}
	}

	/** Card thumbnail: the newest screenshot, else a picture of the diff. */
	async thumb(id: string, worktree: string | null, runIds: readonly string[] = []): Promise<Thumb> {
		const shots = await this.screenshots(id, runIds);
		if (shots.length) {
			return { kind: 'screenshot', name: shots[0].name, url: artifactUrl(id, shots[0].name) };
		}
		if (!worktree) return { kind: 'none' };
		const d = await this.diff(worktree);
		if (!d.available || !d.value.files.length) return { kind: 'none' };
		const files = [...d.value.files]
			.sort(
				(a, b) =>
					(b.additions ?? 0) + (b.deletions ?? 0) - ((a.additions ?? 0) + (a.deletions ?? 0))
			)
			.slice(0, 5)
			.map((f) => ({ path: f.path, additions: f.additions ?? 0, deletions: f.deletions ?? 0 }));
		return { kind: 'diff', files, totalFiles: d.value.total };
	}

	/** Everything the task page shows as evidence. */
	async evidence(
		task: TaskSummary,
		row: SnapshotTask | null,
		runIds: readonly string[] = []
	): Promise<TaskEvidence> {
		const worktree = row?.worktree.present ? row.worktree.path : null;
		const [files, pr, report, shots] = await Promise.all([
			row
				? row.worktree.present
					? this.diff(worktree)
					: Promise.resolve<Available<never>>({
							available: false,
							reason: 'The task’s worktree is no longer there.'
						})
				: Promise.resolve<Available<never>>({
						available: false,
						reason:
							task.status === 'queued'
								? 'Work has not started.'
								: 'The worktree is gone, so the changed files are not kept.'
					}),
			this.pr(task.id, task.pr?.url ?? null),
			this.report(task.id, row?.report.path ?? null),
			this.screenshots(task.id, runIds)
		]);
		const validation: TaskEvidence['validation'] =
			task.current?.source === 'run-step' && task.current.detail
				? {
						available: true,
						source: 'Firstmate’s crew-state read of the validation run',
						observedAt: task.current.observedAt,
						value: { detail: task.current.detail }
					}
				: { available: false, reason: 'No validation run is attributed to this task right now.' };
		return {
			files,
			pr,
			report,
			screenshots: shots.length
				? {
						available: true,
						source: 'Image files in the task’s data folder and its no-mistakes runs',
						observedAt: shots[0].modifiedAt,
						value: shots.map((s) => ({
							name: s.name,
							url: artifactUrl(task.id, s.name),
							modifiedAt: s.modifiedAt
						}))
					}
				: { available: false, reason: 'The worker has not saved any screenshots.' },
			preview: task.preview
				? {
						available: true,
						source: 'A preview URL the worker reported',
						observedAt: task.preview.reportedAt,
						value: { url: task.preview.url }
					}
				: { available: false, reason: 'The worker has not reported a preview URL.' },
			decisions: (row?.openDecisions ?? [])
				.filter((d) => d.summary)
				.map((d) => ({ key: d.key, text: d.summary! })),
			validation
		};
	}
}

export const artifactUrl = (id: string, name: string) =>
	`/api/tasks/${encodeURIComponent(id)}/artifacts/${name.split('/').map(encodeURIComponent).join('/')}`;

function checkState(status: unknown, conclusion: unknown): Check['state'] {
	const c = String(conclusion ?? '').toLowerCase();
	const s = String(status ?? '').toLowerCase();
	if (['success', 'pass', 'passed'].includes(c)) return 'pass';
	if (
		['failure', 'fail', 'failed', 'timed_out', 'cancelled', 'action_required', 'error'].includes(c)
	)
		return 'fail';
	if (['skipped', 'neutral', 'skipping'].includes(c)) return 'skipped';
	if (['in_progress', 'running'].includes(s)) return 'running';
	if (['queued', 'pending', 'waiting', 'requested'].includes(s) || c === 'pending')
		return 'pending';
	return 'unknown';
}

/** First prose paragraph of a Markdown report, bounded. */
export function excerpt(md: string, max = 600): string {
	const paras = md
		.replace(/\r\n?/g, '\n')
		.split(/\n\s*\n/)
		.map((p) => p.trim())
		.filter((p) => p && !p.startsWith('#') && !p.startsWith('```') && !p.startsWith('|'));
	const first = (paras[0] ?? '')
		.replace(/\*\*([^*]+)\*\*/g, '$1')
		.replace(/`([^`]+)`/g, '$1')
		.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
		.replace(/\s+/g, ' ');
	return first.length > max ? `${first.slice(0, max - 1).trimEnd()}…` : first;
}

async function git(
	worktree: string,
	args: string[],
	env: NodeJS.ProcessEnv,
	maxBytes = 1024 * 1024
) {
	return runBounded('git', ['--no-optional-locks', '-C', worktree, ...args], {
		env: { ...env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' },
		timeoutMs: 8000,
		maxOutputBytes: maxBytes
	});
}

async function readDiff(worktree: string, env: NodeJS.ProcessEnv) {
	const observedAt = new Date().toISOString();
	let base: string | null = null;
	const head = await git(
		worktree,
		['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'],
		env
	);
	if (head.ok && head.stdout.trim()) base = head.stdout.trim();
	if (!base) {
		for (const candidate of ['origin/main', 'origin/master', 'main', 'master']) {
			const r = await git(worktree, ['rev-parse', '--verify', '--quiet', candidate], env);
			if (r.ok) {
				base = candidate;
				break;
			}
		}
	}
	if (!base) {
		return {
			available: false as const,
			reason: 'Could not find the base branch in the task worktree.'
		};
	}
	const mb = await git(worktree, ['merge-base', 'HEAD', base], env);
	if (!mb.ok || !mb.stdout.trim()) {
		return { available: false as const, reason: `Could not compare the worktree with ${base}.` };
	}
	const mergeBase = mb.stdout.trim();
	const [numstat, names, branch, untracked] = await Promise.all([
		git(worktree, ['diff', '--numstat', '-M', mergeBase], env),
		git(worktree, ['diff', '--name-status', '-M', mergeBase], env),
		git(worktree, ['rev-parse', '--abbrev-ref', 'HEAD'], env),
		git(worktree, ['ls-files', '--others', '--exclude-standard'], env)
	]);
	if (!numstat.ok || !names.ok) {
		return { available: false as const, reason: 'git diff failed in the task worktree.' };
	}
	const files = parseDiff(numstat.stdout, names.stdout);
	if (untracked.ok) {
		for (const p of untracked.stdout.split('\n')) {
			if (p.trim()) files.push({ path: p, status: '?', additions: null, deletions: null });
		}
	}
	return {
		available: true as const,
		source: `git diff against ${base} in the task worktree, including uncommitted and untracked files`,
		observedAt,
		value: {
			base,
			mergeBase,
			branch: branch.ok && branch.stdout.trim() !== 'HEAD' ? branch.stdout.trim() || null : null,
			files: files.slice(0, MAX_FILES),
			total: files.length,
			truncated: files.length > MAX_FILES
		}
	};
}

async function readPipeline(dir: string): Promise<Pipeline | null> {
	const logs: { key: string; mtimeMs: number; birthtimeMs: number }[] = [];
	for (const n of await readdir(dir)) {
		const key = n.endsWith('.log') ? n.slice(0, -4) : '';
		if (!STEP_LABEL.has(key)) continue;
		const st = await stat(path.join(dir, n)).catch(() => null);
		if (st?.isFile()) logs.push({ key, mtimeMs: st.mtimeMs, birthtimeMs: st.birthtimeMs });
	}
	if (!logs.length) return null;
	logs.sort((a, b) => a.mtimeMs - b.mtimeMs || STEP_ORDER.get(a.key)! - STEP_ORDER.get(b.key)!);
	const current = logs[logs.length - 1];
	const previous = logs.length > 1 ? logs[logs.length - 2] : null;
	const started = current.birthtimeMs > 0 ? current.birthtimeMs : (previous?.mtimeMs ?? null);
	const log = await readTail(path.join(dir, `${current.key}.log`), STEP_LOG_MAX_BYTES);
	return {
		step: current.key,
		label: STEP_LABEL.get(current.key)!,
		startedAt: started === null ? null : iso(started),
		round: log === null ? null : fixRoundFromLog(log)
	};
}

/** Strip git's file headers from a one-file diff, keeping hunks and their lines. */
export function diffBody(text: string): { lines: string[]; binary: boolean } {
	const all = text.replace(/\r\n?/g, '\n').split('\n');
	if (all.at(-1) === '') all.pop();
	const first = all.findIndex((l) => l.startsWith('@@'));
	if (first < 0) return { lines: [], binary: all.some((l) => /^Binary files .* differ$/.test(l)) };
	return { lines: all.slice(first), binary: false };
}

async function readFileDiff(
	worktree: string,
	mergeBase: string,
	base: string,
	entry: FileChange,
	env: NodeJS.ProcessEnv
): Promise<FileDiff> {
	const observedAt = new Date().toISOString();
	const untracked = entry.status === '?';
	const args = untracked
		? ['diff', '--no-index', '--no-color', '--no-ext-diff', '--', '/dev/null', entry.path]
		: [
				'diff',
				'--no-color',
				'--no-ext-diff',
				'--no-textconv',
				'-M',
				mergeBase,
				'--',
				...(entry.oldPath ? [entry.oldPath] : []),
				entry.path
			];
	const r = await git(worktree, args, env, FILE_DIFF_MAX_BYTES);
	// `git diff --no-index` exits 1 when the files differ, which they always do here.
	const ok = r.ok || (untracked && r.kind === 'exit' && r.code === 1);
	if (!ok) {
		return {
			available: false,
			reason:
				r.kind === 'output-limit'
					? `This file’s diff is larger than ${FILE_DIFF_MAX_BYTES / 1024} KB, too large to show here.`
					: 'git diff failed in the task worktree.'
		};
	}
	const { lines, binary } = diffBody(r.stdout);
	if (binary)
		return { available: false, reason: 'This is a binary file, so there is no text diff.' };
	return {
		available: true,
		source: untracked
			? 'the new, uncommitted file in the task worktree'
			: `git diff against ${base} in the task worktree, including uncommitted changes`,
		observedAt,
		value: {
			path: entry.path,
			base,
			lines: lines.slice(0, FILE_DIFF_MAX_LINES),
			truncated: lines.length > FILE_DIFF_MAX_LINES
		}
	};
}

/** Combine `git diff --numstat` and `--name-status` output into one list. */
export function parseDiff(numstat: string, nameStatus: string): FileChange[] {
	const statuses = new Map<string, { code: string; oldPath?: string }>();
	for (const line of nameStatus.split('\n')) {
		const parts = line.split('\t');
		if (parts.length < 2) continue;
		const code = parts[0].charAt(0);
		statuses.set(
			parts[parts.length - 1],
			code === 'R' && parts.length === 3 ? { code, oldPath: parts[1] } : { code }
		);
	}
	const out: FileChange[] = [];
	for (const line of numstat.split('\n')) {
		const parts = line.split('\t');
		if (parts.length < 3) continue;
		const [a, d, ...rest] = parts;
		// Renames print `old => new` or `{a => b}/x`; the name-status line has the new path.
		let p = rest.join('\t');
		if (rest.length === 2) p = rest[1];
		else if (p.includes(' => ')) p = p.replace(/\{[^}]* => ([^}]*)\}/, '$1').replace(/^.* => /, '');
		p = p.replace(/\/\//g, '/');
		const named = statuses.get(p);
		out.push({
			path: p,
			status: named?.code ?? 'M',
			...(named?.oldPath ? { oldPath: named.oldPath } : {}),
			additions: a === '-' ? null : Number(a),
			deletions: d === '-' ? null : Number(d)
		});
	}
	return out;
}

async function readGhPr(url: string, env: NodeJS.ProcessEnv): Promise<TaskEvidence['pr']> {
	const r = await runBounded(
		'gh',
		['pr', 'view', url, '--json', 'number,state,isDraft,reviewDecision,statusCheckRollup'],
		{ env: { ...env, GH_PROMPT_DISABLED: '1' }, timeoutMs: 10_000, maxOutputBytes: 512 * 1024 }
	);
	if (!r.ok) {
		return {
			available: false,
			reason:
				r.kind === 'spawn-error'
					? 'The GitHub CLI (gh) is not installed, and Firstmate has no cached PR observation.'
					: 'Could not read the pull request from GitHub.'
		};
	}
	try {
		const v = JSON.parse(r.stdout);
		const rollup: {
			name?: string;
			context?: string;
			status?: string;
			conclusion?: string;
			state?: string;
		}[] = Array.isArray(v.statusCheckRollup) ? v.statusCheckRollup : [];
		return {
			available: true,
			source: 'GitHub (gh pr view)',
			observedAt: new Date().toISOString(),
			value: {
				url,
				number: typeof v.number === 'number' ? v.number : prNumber(url),
				state: typeof v.state === 'string' ? v.state.toLowerCase() : null,
				draft: typeof v.isDraft === 'boolean' ? v.isDraft : null,
				reviewDecision: v.reviewDecision ? String(v.reviewDecision) : null,
				checks: rollup.map((c) => ({
					name: String(c.name ?? c.context ?? 'check'),
					state: checkState(c.status ?? c.state, c.conclusion ?? c.state)
				}))
			}
		};
	} catch {
		return { available: false, reason: 'GitHub returned an unexpected response.' };
	}
}

/** owner, repo and number of a github.com pull request URL, or null. */
export function githubPull(url: string): { owner: string; repo: string; number: number } | null {
	const m =
		/^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/pull\/(\d+)(?:[/?#].*)?$/.exec(
			url
		);
	return m ? { owner: m[1], repo: m[2], number: Number(m[3]) } : null;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const seconds = (iso: unknown): number | null => {
	const t = typeof iso === 'string' ? Date.parse(iso) : NaN;
	return Number.isNaN(t) ? null : Math.floor(t / 1000);
};

/** PrFeedback from GitHub's REST answers (a pull, its head commit, its reviews, its review comments). */
export function parsePrFeedback(pull: any, commit: any, reviews: any, comments: any): PrFeedback {
	const sha = typeof pull?.head?.sha === 'string' ? pull.head.sha : null;
	return {
		head: sha
			? { sha, at: seconds(commit?.commit?.committer?.date ?? commit?.commit?.author?.date) }
			: null,
		reviews: (Array.isArray(reviews) ? reviews : []).flatMap((r: any) => {
			const at = seconds(r?.submitted_at);
			return at === null || typeof r?.state !== 'string'
				? []
				: [{ state: r.state, at, commitId: typeof r.commit_id === 'string' ? r.commit_id : null }];
		}),
		comments: (Array.isArray(comments) ? comments : []).flatMap((c: any) => {
			const at = seconds(c?.created_at);
			return at === null
				? []
				: [{ at, commitId: typeof c.commit_id === 'string' ? c.commit_id : null }];
		})
	};
}

async function readPrFeedback(
	t: { owner: string; repo: string; number: number },
	env: NodeJS.ProcessEnv
): Promise<PrFeedback | null> {
	// Only GET requests: Wheelhouse reads the forge, never writes to it.
	const get = async (endpoint: string): Promise<any> => {
		const r = await runBounded('gh', ['api', '-X', 'GET', endpoint], {
			env: { ...env, GH_PROMPT_DISABLED: '1' },
			timeoutMs: 10_000,
			maxOutputBytes: 2 * 1024 * 1024
		});
		if (!r.ok) throw new Error(r.message);
		return JSON.parse(r.stdout);
	};
	const base = `repos/${t.owner}/${t.repo}`;
	try {
		const pull = await get(`${base}/pulls/${t.number}`);
		const sha = typeof pull?.head?.sha === 'string' ? pull.head.sha : null;
		const [commit, reviews, comments] = await Promise.all([
			sha ? get(`${base}/commits/${sha}`) : Promise.resolve(null),
			get(`${base}/pulls/${t.number}/reviews?per_page=100`),
			get(`${base}/pulls/${t.number}/comments?per_page=100`)
		]);
		return parsePrFeedback(pull, commit, reviews, comments);
	} catch {
		return null;
	}
}
