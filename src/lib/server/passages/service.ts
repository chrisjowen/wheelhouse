import { createHash } from 'node:crypto';
import { BUILTIN } from './builtin';
import {
	defaultDeps,
	readTaskRefs,
	repoOfPr,
	runCheck,
	statusNote,
	type CheckDeps,
	type CheckResult,
	type TaskRefs
} from './checks';
import type { ConsentStore } from './consent';
import { evaluate, holds, reachedIndex, type CheckLookup, type CheckState } from './engine';
import type { ReachedStore } from './reached';
import {
	fromBase,
	referencedChecks,
	resolvePassage,
	type Layer,
	type Origin,
	type ResolvedPassage
} from './resolve';
import { Scheduler, type Job } from './scheduler';
import {
	describeCond,
	durationMs,
	NETWORK_CHECKS,
	parsePassage,
	refsOf,
	type CheckSpec,
	type CheckType,
	type CommitValue,
	type Cond
} from './schema';
import {
	readCaptainFile,
	readClone,
	readProjectFile,
	type ProjectClone,
	type SourceText
} from './sources';
import type { StageFacts, StageModel } from '../firstmate/stages';
import type {
	Passage,
	PassageCheckDef,
	PassageSource,
	ProjectPassage,
	ProjectPassageSummary,
	Track
} from '../../types';

/**
 * Per-project passages: loads each project's passage files (the project's
 * `.wheelhouse.yaml` from its default branch, then the captain-owned file),
 * resolves them over the built-ins, and runs their declared checks in the
 * background. It plugs into the collector through `stagesFor(projectId)`.
 *
 * Budget: checks never run while the fleet is derived. Each derivation only
 * records which checks a task could still use (a step it has not reached yet,
 * a failed step that may recover, or the evidence of its current step), and
 * the scheduler runs those on their own cadence, a few at a time. A check
 * that needs a commit waits until the commit exists (the merge commit after
 * the merge, the PR head while a PR is recorded), and tasks that landed more
 * than 30 days ago are not checked at all.
 *
 * A project file's network checks (GitHub, npm, HTTP) run only once the
 * captain has enabled that version of the file (consent.ts).
 *
 * A step reached through observed checks is recorded (reached.ts), so it stays
 * reached after a restart even when its checks can no longer observe it.
 */

export interface PassageServiceOptions {
	homeDir: string;
	firstmateDir: string;
	/** The captain-owned Wheelhouse config directory, or null when unusable. */
	configDir: string | null;
	configProblem?: string | null;
	consent: ConsentStore | null;
	consentProblem?: string | null;
	/** Where steps reached through checks are recorded, or null to keep them in memory only. */
	reached?: ReachedStore | null;
	deps?: CheckDeps;
	/** GitHub reads allowed (WHEELHOUSE_NO_GH=1 turns them off). */
	useGh?: boolean;
	now?: () => number;
	/** How often a project's passage files are re-read. */
	refreshMs?: number;
	maxConcurrent?: number;
	/** Projects that never have passage files (e.g. tasks with no project). */
	ignore?: string[];
}

/** Tasks that landed longer ago than this are not checked. */
export const CHECK_HORIZON_MS = 30 * 86_400_000;
const REFS_INTERVAL_MS = 60_000;
const DEFAULT_INTERVAL: Record<CheckType, string> = {
	'github.deployment': '60s',
	'github.workflow': '60s',
	'github.release': '5m',
	'npm.published': '5m',
	http: '60s',
	'git.contains': '60s',
	'status.note': '60s'
};

interface Loaded {
	id: string;
	loadedAt: number;
	clone: ProjectClone | null;
	cloneProblem: string | null;
	project: SourceText | null;
	captain: SourceText | null;
	errors: Record<Layer['origin'], string[]>;
	applied: Record<Layer['origin'], boolean>;
	resolved: Record<Track, ResolvedPassage>;
}

interface RefsResult {
	refs: TaskRefs;
	merged: boolean;
	problem: string | null;
}

/** What one check looks like for one task this round. */
interface Internal {
	view: CheckState;
	result: CheckResult | null;
	job: Job<CheckResult> | null;
	refsJob: Job<RefsResult> | null;
}

const BUILTIN_RESOLVED: Record<Track, ResolvedPassage> = {
	ship: fromBase(BUILTIN.ship),
	scout: fromBase(BUILTIN.scout)
};

const specDigest = (spec: CheckSpec) =>
	createHash('sha256').update(JSON.stringify(spec)).digest('hex').slice(0, 16);

function commitNeed(spec: CheckSpec): CommitValue | null {
	switch (spec.type) {
		case 'github.deployment':
		case 'github.workflow':
			return spec.ref;
		case 'github.release':
			return spec.contains;
		case 'git.contains':
			return spec.commit;
		case 'http': {
			const e = spec.expect?.equals;
			return e === 'merge.commit' || e === 'pr.head' ? e : null;
		}
		default:
			return null;
	}
}

/** The declared checks a condition references. */
const checksIn = (resolved: ResolvedPassage, c: Cond | undefined) =>
	refsOf(c)
		.map((r) => r.slice(0, r.indexOf('.')))
		.filter((id) => resolved.checks.has(id));

const waiting = (summary: string, state: CheckState['state'] = 'waiting'): Internal => ({
	view: { state, outcomes: [], summary, url: null, observedAt: null },
	result: null,
	job: null,
	refsJob: null
});

export class PassageService {
	private loaded = new Map<string, Loaded>();
	private loading = new Map<string, Promise<void>>();
	private models = new Map<string, StageModel>();
	private checks: Scheduler<CheckResult>;
	private refs: Scheduler<RefsResult>;
	private demandChecks = new Map<string, Job<CheckResult>>();
	private demandRefs = new Map<string, Job<RefsResult>>();
	private firstSeen = new Map<string, number>();
	private deps: CheckDeps;
	private now: () => number;
	private refreshMs: number;
	private useGh: boolean;
	private ignore: Set<string>;
	/** Called when a file was (re)loaded or a check finished, so the fleet can be rebuilt. */
	onChange: () => void = () => {};

	constructor(private opts: PassageServiceOptions) {
		this.deps = opts.deps ?? defaultDeps();
		this.now = opts.now ?? this.deps.now;
		this.refreshMs = opts.refreshMs ?? 60_000;
		this.useGh = opts.useGh ?? true;
		this.ignore = new Set(opts.ignore ?? []);
		const changed = () => this.onChange();
		this.checks = new Scheduler<CheckResult>({
			now: this.now,
			maxConcurrent: opts.maxConcurrent ?? 2,
			onChange: changed
		});
		this.refs = new Scheduler<RefsResult>({ now: this.now, maxConcurrent: 2, onChange: changed });
	}

	stop(): void {
		this.checks.stop();
		this.refs.stop();
	}

	running(): number {
		return this.checks.active() + this.refs.active();
	}

	health(): { configDir: string | null; problem: string | null; checksRunning: number } {
		return {
			configDir: this.opts.configDir,
			problem: this.opts.configProblem ?? null,
			checksRunning: this.running()
		};
	}

	/** The stage model for a project (the collector's `stagesFor`). */
	stagesFor = (projectId: string): StageModel => {
		let m = this.models.get(projectId);
		if (!m) {
			m = { passage: (f) => this.passage(projectId, f) };
			this.models.set(projectId, m);
		}
		return m;
	};

	/**
	 * End of one fleet derivation: run the checks it wanted, and re-read the
	 * passage files of these projects when they are due.
	 */
	endRound(projectIds: Iterable<string>): void {
		this.checks.want([...this.demandChecks.values()]);
		this.refs.want([...this.demandRefs.values()]);
		this.demandChecks = new Map();
		this.demandRefs = new Map();
		for (const id of projectIds) {
			const l = this.loaded.get(id);
			if (!l || this.now() - l.loadedAt >= this.refreshMs) void this.load(id);
		}
	}

	/** Load (or re-load) a project's passage files now. */
	async load(projectId: string): Promise<void> {
		if (this.ignore.has(projectId)) return;
		const inFlight = this.loading.get(projectId);
		if (inFlight) return inFlight;
		const p = this.read(projectId).finally(() => this.loading.delete(projectId));
		this.loading.set(projectId, p);
		return p;
	}

	private async read(id: string): Promise<void> {
		const { clone, problem } = await readClone(this.opts.homeDir, id, this.deps);
		const project = clone ? await readProjectFile(clone, this.deps) : null;
		const captain = this.opts.configDir ? await readCaptainFile(this.opts.configDir, id) : null;
		const errors: Loaded['errors'] = { project: [], captain: [] };
		const layers: Layer[] = [];
		for (const [origin, src] of [
			['project', project],
			['captain', captain]
		] as const) {
			if (!src) continue;
			if (src.state === 'unreadable') errors[origin].push(src.problem ?? 'Could not read it.');
			if (src.state !== 'read' || src.text === null) continue;
			const r = parsePassage(src.text, {
				kind: 'overlay',
				captain: origin === 'captain',
				project: id
			});
			if (r.ok) layers.push({ origin, file: r.value });
			else errors[origin].push(...r.errors);
		}
		const resolved = {} as Record<Track, ResolvedPassage>;
		for (const track of ['ship', 'scout'] as const) {
			const mine = layers.filter((l) => (l.file.extends ?? 'ship') === track);
			const r = resolvePassage(BUILTIN[track], mine);
			// Only a layer that fits changes the passage; otherwise it stays the shared built-in.
			resolved[track] = mine.some((l) => !r.errors.has(l.origin))
				? r.passage
				: BUILTIN_RESOLVED[track];
			for (const [origin, errs] of r.errors) errors[origin].push(...errs);
		}
		const applied = {
			project: layers.some((l) => l.origin === 'project') && !errors.project.length,
			captain: layers.some((l) => l.origin === 'captain') && !errors.captain.length
		};
		const before = this.loaded.get(id);
		this.loaded.set(id, {
			id,
			loadedAt: this.now(),
			clone,
			cloneProblem: problem,
			project,
			captain,
			errors,
			applied,
			resolved
		});
		const same =
			before &&
			before.project?.digest === project?.digest &&
			before.captain?.digest === captain?.digest &&
			before.project?.state === project?.state &&
			before.captain?.state === captain?.state;
		if (!same) this.onChange();
	}

	private consented(projectId: string, l: Loaded | undefined): boolean {
		const digest = l?.project?.digest ?? null;
		return !!this.opts.consent && this.opts.consent.enabled(projectId, digest);
	}

	/** Enable the project file with this digest (or turn its checks off with null). */
	async setConsent(
		projectId: string,
		digest: string | null
	): Promise<{ ok: true } | { ok: false; status: 409 | 503; message: string }> {
		const store = this.opts.consent;
		if (!store) {
			return {
				ok: false,
				status: 503,
				message: this.opts.consentProblem ?? 'Wheelhouse cannot record consent.'
			};
		}
		const l = this.loaded.get(projectId);
		if (digest !== null && l?.project?.digest !== digest) {
			return {
				ok: false,
				status: 409,
				message:
					'The project file changed since this page was loaded. Review it again before enabling it.'
			};
		}
		await store.set(projectId, digest);
		this.onChange();
		return { ok: true };
	}

	private passage(projectId: string, f: StageFacts) {
		const l = this.loaded.get(projectId);
		const resolved = l?.resolved[f.track] ?? BUILTIN_RESOLVED[f.track];
		if (!resolved.checks.size) return evaluate(resolved, f);
		const memo = new Map<string, Internal>();
		const look = (id: string): Internal | undefined => {
			if (!resolved.checks.has(id)) return undefined;
			let s = memo.get(id);
			if (!s) {
				s = this.checkState(projectId, l, resolved, id, f, look);
				memo.set(id, s);
			}
			return s;
		};
		const labels = (id: string) => resolved.checks.get(id)?.spec.label ?? id;
		const lookup: CheckLookup = (id) => look(id)?.view;
		const floor = this.reachedFloor(projectId, resolved, f, lookup);
		const passage = evaluate(resolved, f, lookup, labels, floor);
		if (f.taskId) {
			const reached = reachedIndex(resolved, f, lookup, floor);
			this.settlePast(projectId, resolved, passage, reached, lookup, f.taskId);
			this.demand(resolved, reached, passage.current, f, look);
		}
		return passage;
	}

	/**
	 * The furthest step this task has reached through checks: recorded before,
	 * or reached now on observed results (then recorded).
	 */
	private reachedFloor(
		projectId: string,
		resolved: ResolvedPassage,
		f: StageFacts,
		lookup: CheckLookup
	): number {
		const store = this.opts.reached;
		if (!store || !f.taskId) return 0;
		const kept = store.get(projectId, f.taskId);
		let floor = 0;
		resolved.steps.forEach((s, i) => {
			const ids = checksIn(resolved, s.reached_when);
			if (!ids.length) return;
			if (kept.includes(s.id)) {
				floor = i;
			} else if (
				ids.every((id) => lookup(id)?.state === 'observed') &&
				holds(s.reached_when, f, lookup)
			) {
				void store.add(projectId, f.taskId!, s.id).catch(() => {});
				floor = i;
			}
		});
		return floor;
	}

	/**
	 * Steps below the furthest reached one (not below a later failed step, which
	 * may recover) whose skip_when or note depends on checks are
	 * shown as they were recorded, since those checks no longer run; the first
	 * time such a step is past with every check observed, it is recorded.
	 */
	private settlePast(
		projectId: string,
		resolved: ResolvedPassage,
		passage: Passage,
		reached: number,
		lookup: CheckLookup,
		taskId: string
	): void {
		const store = this.opts.reached;
		if (!store) return;
		const kept = store.past(projectId, taskId);
		for (let i = 0; i < reached; i++) {
			const s = resolved.steps[i];
			const when = typeof s.note === 'object' ? s.note.when : undefined;
			const ids = [...checksIn(resolved, s.skip_when), ...checksIn(resolved, when)];
			if (!ids.length) continue;
			const step = passage.steps[i];
			const k = kept[s.id];
			if (k) {
				passage.steps[i] = { ...step, state: k.skipped ? 'skipped' : 'done', note: k.note };
			} else if (ids.every((id) => (lookup(id)?.outcomes.length ?? 0) > 0)) {
				void store
					.settle(projectId, taskId, s.id, { skipped: step.state === 'skipped', note: step.note })
					.catch(() => {});
			}
		}
	}

	/** Record the checks this task could still use, for the scheduler. */
	private demand(
		resolved: ResolvedPassage,
		reached: number,
		current: number,
		f: StageFacts,
		look: (id: string) => Internal | undefined
	): void {
		const wanted = new Set<string>();
		resolved.steps.forEach((s, i) => {
			if (i > reached) {
				for (const id of referencedChecks(s)) wanted.add(id);
			}
			if (i >= reached) {
				const when = typeof s.note === 'object' ? s.note.when : undefined;
				for (const id of [...checksIn(resolved, s.skip_when), ...checksIn(resolved, when)])
					wanted.add(id);
			}
			if (i === current) {
				for (const e of s.evidence) if (e.startsWith('check:')) wanted.add(e.slice(6));
				if (s.primary_link) wanted.add(s.primary_link.slice(0, -'.url'.length));
			}
		});
		for (const id of [...wanted]) {
			const spec = resolved.checks.get(id)?.spec;
			if (spec?.type === 'npm.published') wanted.add(spec.version_from);
		}
		for (const id of wanted) {
			const seen = `${f.taskId}|${id}`;
			if (!this.firstSeen.has(seen)) {
				this.firstSeen.set(seen, this.now());
				if (this.firstSeen.size > 5000) this.firstSeen.delete(this.firstSeen.keys().next().value!);
			}
			const s = look(id);
			if (s?.job) this.demandChecks.set(s.job.key, s.job);
			if (s?.refsJob) this.demandRefs.set(s.refsJob.key, s.refsJob);
		}
	}

	private refsFor(
		f: StageFacts,
		need: CommitValue
	):
		| { ok: true; sha: string; refs: TaskRefs; job: Job<RefsResult> }
		| { ok: false; internal: Internal } {
		// Without a ledger merge record, the pull request itself must report MERGED.
		if (need === 'merge.commit' && !f.merged && !f.prUrl)
			return { ok: false, internal: waiting('Waits for the merge.') };
		if (!f.prUrl) {
			return {
				ok: false,
				internal: waiting(
					need === 'merge.commit'
						? 'No merge commit is known: it landed without a pull request.'
						: 'Waits for a pull request.'
				)
			};
		}
		if (!this.useGh) {
			return {
				ok: false,
				internal: waiting('GitHub reads are turned off, so the commit is not known.', 'unknown')
			};
		}
		const prUrl = f.prUrl;
		const job: Job<RefsResult> = {
			key: `refs|${prUrl}`,
			run: () => readTaskRefs(prUrl, this.deps),
			intervalMs: REFS_INTERVAL_MS,
			giveUpAt: null,
			terminal: (r) => r.merged && !!r.refs.mergeCommit
		};
		const s = this.refs.status(job.key)?.result;
		const pending = (summary: string, state: CheckState['state'] = 'waiting') => ({
			ok: false as const,
			internal: { ...waiting(summary, state), refsJob: job }
		});
		if (!s) return pending('Looking up the pull request’s commits.');
		if (s.problem) return pending(`Can't read the pull request: ${s.problem}.`, 'unknown');
		if (need === 'merge.commit' && !f.merged && !s.merged) return pending('Waits for the merge.');
		const sha = need === 'merge.commit' ? s.refs.mergeCommit : s.refs.prHead;
		if (!sha) {
			return pending(
				need === 'merge.commit'
					? 'GitHub reports no merge commit yet.'
					: 'GitHub reports no head commit.'
			);
		}
		return { ok: true, sha, refs: s.refs, job };
	}

	private checkState(
		projectId: string,
		l: Loaded | undefined,
		resolved: ResolvedPassage,
		id: string,
		f: StageFacts,
		look: (id: string) => Internal | undefined
	): Internal {
		const c = resolved.checks.get(id)!;
		const spec = c.spec;
		const now = this.now();
		if (spec.type === 'status.note') {
			const r = statusNote(f.preview, now);
			return {
				view: {
					state: 'observed',
					outcomes: r.outcomes,
					summary: r.summary,
					url: r.url,
					observedAt: r.observedAt
				},
				result: r,
				job: null,
				refsJob: null
			};
		}
		if (c.origin === 'project' && NETWORK_CHECKS.has(spec.type) && !this.consented(projectId, l)) {
			return waiting(
				'Off until you enable this project’s passage checks on its passage page.',
				'off'
			);
		}
		if (!this.useGh && spec.type.startsWith('github.')) {
			return waiting('GitHub reads are turned off (WHEELHOUSE_NO_GH).', 'unknown');
		}
		const old = f.landedAt != null && now - f.landedAt > CHECK_HORIZON_MS;

		let refs: TaskRefs = { mergeCommit: null, prHead: null };
		let input = '';
		let refsJob: Job<RefsResult> | null = null;
		const need = commitNeed(spec);
		if (need) {
			if (old) return waiting('Not checked: it landed more than 30 days ago.', 'gave-up');
			const r = this.refsFor(f, need);
			if (!r.ok) return r.internal;
			refs = r.refs;
			input = r.sha;
			refsJob = r.job;
		}
		let releaseTag: string | null = null;
		if (spec.type === 'npm.published') {
			const rel = look(spec.version_from);
			releaseTag = rel?.result?.fields.tag ?? null;
			if (!releaseTag) {
				return waiting(
					`Waits for ${resolved.checks.get(spec.version_from)?.spec.label ?? spec.version_from} to find a release.`
				);
			}
			input = releaseTag;
		}

		const key = `${f.taskId}|${id}|${specDigest(spec)}|${input}`;
		const status = this.checks.status(key);
		if (old && !status?.result)
			return waiting('Not checked: it landed more than 30 days ago.', 'gave-up');

		const ms = durationMs(spec.interval ?? DEFAULT_INTERVAL[spec.type]) ?? 60_000;
		const job: Job<CheckResult> = {
			key,
			run: async () => {
				const r = await runCheck(
					spec,
					{
						taskId: f.taskId ?? '',
						refs,
						repo:
							('repo' in spec && typeof spec.repo === 'string' ? spec.repo : null) ??
							repoOfPr(f.prUrl) ??
							l?.clone?.repo ??
							null,
						clone: l?.clone ? { dir: l.clone.dir, defaultRef: l.clone.defaultRef } : null,
						firstmateRoot: this.opts.firstmateDir,
						releaseTag
					},
					this.deps
				);
				const prev = this.checks.status(key)?.result;
				if (r.outcome !== null || !prev?.outcomes.length) return r;
				return { ...prev, outcome: null, summary: r.summary, terminal: false };
			},
			intervalMs: Math.max(30_000, ms),
			giveUpAt: this.giveUpAt(resolved, id, f),
			terminal: (r) => r.terminal
		};
		const r = status?.result ?? null;
		let view: CheckState;
		if (!r) {
			view = {
				state: 'waiting',
				outcomes: [],
				summary: status?.running ? 'Checking now.' : 'Not checked yet.',
				url: null,
				observedAt: null
			};
		} else {
			view = {
				state: status?.gaveUp ? 'gave-up' : r.outcome ? 'observed' : 'unknown',
				outcomes: r.outcomes,
				summary: r.summary,
				url: r.url,
				observedAt: r.observedAt
			};
		}
		return { view, result: r, job: status?.gaveUp ? null : job, refsJob };
	}

	/** When checking stops: every step that depends on the check must declare give_up_after. */
	private giveUpAt(resolved: ResolvedPassage, id: string, f: StageFacts): number | null {
		const steps = resolved.steps.filter((s) => referencedChecks(s).includes(id));
		if (!steps.length || steps.some((s) => !s.giveUpAfter)) return null;
		const ms = Math.max(...steps.map((s) => s.giveUpAfter!.ms));
		const from = f.landedAt ?? this.firstSeen.get(`${f.taskId}|${id}`) ?? this.now();
		return from + ms;
	}

	summary(projectId: string): ProjectPassageSummary | null {
		const l = this.loaded.get(projectId);
		if (!l) return null;
		const view = this.build(projectId, l);
		return {
			custom: view.passages.some((p) => p.custom),
			problems: view.sources.reduce((n, s) => n + s.errors.length, 0),
			needsConsent: view.consent.needed && !view.consent.enabled
		};
	}

	/** The project's passage panel, re-reading its files first when they are due. */
	async view(projectId: string): Promise<ProjectPassage> {
		const l = this.loaded.get(projectId);
		if (!this.ignore.has(projectId) && (!l || this.now() - l.loadedAt >= this.refreshMs)) {
			await this.load(projectId);
		}
		return this.build(projectId, this.loaded.get(projectId));
	}

	private build(projectId: string, l: Loaded | undefined): ProjectPassage {
		const notes: string[] = [];
		if (this.ignore.has(projectId)) notes.push('Tasks with no project use the built-in passages.');
		else if (l && !l.clone)
			notes.push(
				`${l.cloneProblem ?? 'There is no project clone.'} Only the captain-owned file can shape this passage.`
			);
		if (!this.opts.configDir) {
			notes.push(
				this.opts.configProblem ?? 'There is no captain-owned Wheelhouse config directory.'
			);
		}
		const sources: PassageSource[] = [];
		for (const origin of ['project', 'captain'] as const) {
			const src = l?.[origin];
			if (!src) continue;
			const errors = l!.errors[origin];
			sources.push({
				kind: origin,
				location: src.location,
				state:
					src.state === 'absent'
						? 'absent'
						: src.state === 'unreadable'
							? 'unreadable'
							: errors.length
								? 'invalid'
								: 'applied',
				digest: src.digest,
				errors
			});
		}
		const consented = this.consented(projectId, l);
		const passages = (['ship', 'scout'] as const).map((track) => {
			const p = l?.resolved[track] ?? BUILTIN_RESOLVED[track];
			const checks: PassageCheckDef[] = [...p.checks.values()].map((c) => ({
				id: c.id,
				label: c.spec.label ?? c.id,
				type: c.spec.type,
				origin: c.origin,
				params: params(c.spec),
				interval:
					c.spec.type === 'status.note'
						? 'read with the fleet'
						: (c.spec.interval ?? DEFAULT_INTERVAL[c.spec.type]),
				network: NETWORK_CHECKS.has(c.spec.type),
				enabled: !(c.origin === 'project' && NETWORK_CHECKS.has(c.spec.type)) || consented
			}));
			return {
				track,
				custom: p !== BUILTIN_RESOLVED[track],
				live: p.liveStep,
				checks,
				steps: p.steps.map((s) => ({
					id: s.id,
					label: s.label,
					origin: s.origin,
					changedBy: s.changedBy,
					reachedWhen: s.reached_when !== undefined ? describeCond(s.reached_when) : null,
					skipWhen: s.skip_when !== undefined ? describeCond(s.skip_when) : null,
					failedWhen: s.failed_when !== undefined ? describeCond(s.failed_when) : null,
					evidence: s.evidence,
					primaryLink: s.primary_link ?? null,
					giveUpAfter: s.giveUpAfter?.text ?? null,
					note:
						s.note === undefined
							? null
							: typeof s.note === 'string'
								? s.note
								: `${s.note.text} (when ${describeCond(s.note.when)})`
				}))
			};
		});
		const needed =
			!!l?.applied.project &&
			passages.some((p) => p.checks.some((c) => c.origin === 'project' && c.network));
		return {
			schema: 'wheelhouse-passage.v1',
			projectId,
			sources,
			notes,
			passages,
			consent: {
				needed,
				enabled: needed && consented,
				digest: l?.project?.digest ?? null,
				enabledAt: consented ? (this.opts.consent?.enabledAt(projectId) ?? null) : null,
				unavailable: this.opts.consent
					? null
					: (this.opts.consentProblem ?? 'Wheelhouse cannot record consent.')
			},
			readAt: l ? new Date(l.loadedAt).toISOString() : null
		};
	}
}

function params(spec: CheckSpec): string {
	switch (spec.type) {
		case 'github.deployment':
			return `environment ${spec.environment} at ${spec.ref}${spec.repo ? ` in ${spec.repo}` : ''}`;
		case 'github.workflow':
			return `workflow ${spec.workflow} at ${spec.ref}${spec.event ? ` (${spec.event})` : ''}${spec.repo ? ` in ${spec.repo}` : ''}`;
		case 'github.release':
			return `a release${spec.tag_pattern ? ` tagged ${spec.tag_pattern}` : ''} containing ${spec.contains}${spec.repo ? ` in ${spec.repo}` : ''}`;
		case 'npm.published':
			return `${spec.package} at the version of ${spec.version_from}'s release`;
		case 'http': {
			const e = spec.expect;
			const want = e?.json_pointer
				? `, expecting ${e.json_pointer}${e.equals !== undefined ? ` = ${e.equals}` : ''}`
				: e?.status
					? `, expecting ${e.status}`
					: '';
			const headers = spec.headers_from_env
				? `, headers from ${Object.values(spec.headers_from_env).join(', ')}`
				: '';
			return `${spec.method ?? 'GET'} ${spec.url}${want}${headers}`;
		}
		case 'git.contains':
			return `${spec.commit} on ${spec.ref ?? 'the default branch'} of the ${spec.repo === 'firstmate-root' ? 'Firstmate checkout' : 'project clone'}`;
		case 'status.note':
			return 'the worker’s `preview <url>` status line';
	}
}

export type { Origin };
