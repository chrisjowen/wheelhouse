import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { runBounded } from './exec';
import { prNumber } from './model';
import { TASK_ID } from './adapter';
import type { SnapshotTask } from './contracts';
import type { Available, Check, FileChange, TaskEvidence, TaskSummary, Thumb } from '../../types';

/**
 * Read-only evidence for a task, derived from records Firstmate keeps:
 * - changed files: `git diff` in the task worktree Firstmate recorded;
 * - PR state and checks: Firstmate's cached forge observation in
 *   data/<id>/contributions.json, else `gh pr view` on the recorded PR URL;
 * - report: data/<id>/report.md;
 * - screenshots: image files under data/<id>/screenshots/ or data/<id>/;
 * - screenshots also come from the no-mistakes evidence folder of the task's
 *   validation runs.
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
	private diffs: TtlCache<
		Available<{
			base: string;
			branch: string | null;
			files: FileChange[];
			truncated: boolean;
		}>
	>;
	private prs: TtlCache<TaskEvidence['pr']>;
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
		this.diffs = new TtlCache(30_000, this.now);
		this.prs = new TtlCache(60_000, this.now);
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
		return { kind: 'diff', files, totalFiles: d.value.files.length };
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
			branch: branch.ok && branch.stdout.trim() !== 'HEAD' ? branch.stdout.trim() || null : null,
			files: files.slice(0, MAX_FILES),
			truncated: files.length > MAX_FILES
		}
	};
}

/** Combine `git diff --numstat` and `--name-status` output into one list. */
export function parseDiff(numstat: string, nameStatus: string): FileChange[] {
	const statuses = new Map<string, string>();
	for (const line of nameStatus.split('\n')) {
		const parts = line.split('\t');
		if (parts.length < 2) continue;
		const code = parts[0].charAt(0);
		statuses.set(parts[parts.length - 1], code);
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
		out.push({
			path: p.replace(/\/\//g, '/'),
			status: statuses.get(p) ?? 'M',
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
