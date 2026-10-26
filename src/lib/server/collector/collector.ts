import type { FirstmateAdapter } from '../firstmate/adapter';
import type { FleetSnapshot, PrimaryReady, SnapshotTask } from '../firstmate/contracts';
import { artifactUrl, type EvidenceReader } from '../firstmate/evidence';
import type { Compatibility } from '../firstmate/install';
import type { LedgerReader, LedgerTask } from '../firstmate/ledger';
import {
	addressingReview,
	backlogOnly,
	deriveTasks,
	runPhase,
	type LiveSignals,
	type ProjectRegistryEntry,
	type ReviewSignals
} from '../firstmate/model';
import type { InsightsService, TaskMeta } from '../insights/service';
import { buildHint, type BuildReader } from '../buildlog/reader';
import type { PassageService } from '../passages/service';
import type { Messenger } from '../store/messenger';
import type { ShipsBell } from '../bell/bell';
import type { FleetView, Health, Messaging, MessagesView, Supervisor, Thumb } from '../../types';

/**
 * The one shared collector. Every ~5 s it reads Firstmate's readiness and the
 * new lines of the fleet ledger; the full fleet snapshot (which takes seconds
 * and grows with the fleet) runs on an adaptive cadence: about twice its own
 * last duration, never more often than every 5 s and at least every 30 s, and
 * sooner when the ledger shows activity. Results are cached in memory and
 * pushed to subscribers (the SSE endpoint).
 *
 * A failed read keeps the last good view but marks it stale, so the UI can say
 * how old its information is instead of showing stale data as current.
 *
 * Each round also reconciles the messages Wheelhouse sent to Firstmate (see
 * store/messenger.ts); message changes are pushed to the same subscribers.
 * Each round's fleet view then goes to the ship's bell (see bell/bell.ts).
 */

export type CollectorEvent =
	| { type: 'fleet'; data: FleetView }
	| { type: 'health'; data: Health }
	| { type: 'messages'; data: MessagesView };

export interface CollectorOptions {
	adapter: FirstmateAdapter;
	compatibility: Compatibility;
	install: { firstmateDir: string; homeDir: string };
	version: string;
	evidence?: EvidenceReader | null;
	ledger?: LedgerReader | null;
	/** Reads Firstmate's project registry; failures yield an empty list. */
	registry?: (dataDir: string) => Promise<ProjectRegistryEntry[]>;
	messenger?: Messenger | null;
	/** Per-project passages and their checks (the built-ins when absent). */
	passages?: PassageService | null;
	/** Time splits, work-time estimates, decisions made for the captain, and headroom. */
	insights?: InsightsService | null;
	/** The docs each task's session referenced, for the card's hint. */
	build?: BuildReader | null;
	/** The ship's bell, which raises alerts from each round's fleet view. */
	bell?: ShipsBell | null;
	/** Why messaging is off when there is no messenger at all (e.g. no usable store). */
	messagingUnavailable?: string;
	intervalMs?: number;
	minSnapshotIntervalMs?: number;
	maxSnapshotIntervalMs?: number;
	now?: () => number;
}

const DEFAULT_INTERVAL = 5_000;
/** How many of a task's newest screenshots its card shows as thumbnails. */
const CARD_SHOTS = 4;

export class Collector {
	private opts: Required<
		Pick<CollectorOptions, 'intervalMs' | 'minSnapshotIntervalMs' | 'maxSnapshotIntervalMs'>
	> &
		CollectorOptions;
	private now: () => number;
	private timer: ReturnType<typeof setTimeout> | null = null;
	private running = false;
	private ticking: Promise<void> | null = null;
	private listeners = new Set<(e: CollectorEvent) => void>();

	private snapshot: FleetSnapshot | null = null;
	private ready: PrimaryReady | null = null;
	private readyError: string | null = null;
	private lastSnapshotStart = Number.NEGATIVE_INFINITY;
	private lastSnapshotDuration = 0;
	private lastAttemptAt: number | null = null;
	private lastSuccessAt: number | null = null;
	private consecutiveFailures = 0;
	private lastError: string | null = null;
	private thumbs = new Map<string, Thumb>();
	private review = new Map<string, ReviewSignals>();
	private live = new Map<string, LiveSignals>();
	private registry: ProjectRegistryEntry[] = [];
	private fleet: FleetView | null = null;

	constructor(opts: CollectorOptions) {
		this.opts = {
			intervalMs: DEFAULT_INTERVAL,
			minSnapshotIntervalMs: DEFAULT_INTERVAL,
			maxSnapshotIntervalMs: 30_000,
			...opts
		};
		this.now = opts.now ?? Date.now;
		opts.messenger?.subscribe((data) => this.emit({ type: 'messages', data }));
		if (opts.passages) opts.passages.onChange = () => this.passagesChanged();
	}

	private passageTimer: ReturnType<typeof setTimeout> | null = null;

	/** A passage file was re-read or a check finished: push the new passages soon (coalesced). */
	private passagesChanged(): void {
		if (this.passageTimer || !this.snapshot) return;
		this.passageTimer = setTimeout(() => {
			this.passageTimer = null;
			if (!this.running) return;
			this.rebuild();
			this.emit({ type: 'fleet', data: this.fleet! });
		}, 250);
	}

	/** Current snapshot cadence: about twice the last snapshot's duration, bounded. */
	snapshotIntervalMs(): number {
		const { minSnapshotIntervalMs: min, maxSnapshotIntervalMs: max } = this.opts;
		return Math.min(max, Math.max(min, this.lastSnapshotDuration * 2));
	}

	/** How old the last good snapshot may be before the view is called stale. */
	staleAfterMs(): number {
		return Math.max(30_000, this.snapshotIntervalMs() * 3);
	}

	start(): void {
		if (this.running) return;
		this.running = true;
		void this.loop();
	}

	stop(): void {
		this.running = false;
		if (this.timer) clearTimeout(this.timer);
		this.timer = null;
		if (this.passageTimer) clearTimeout(this.passageTimer);
		this.passageTimer = null;
		this.opts.passages?.stop();
	}

	private async loop(): Promise<void> {
		if (!this.running) return;
		const started = this.now();
		try {
			await this.tick();
		} catch (err) {
			this.consecutiveFailures++;
			this.lastError = err instanceof Error ? err.message : String(err);
		}
		if (!this.running) return;
		const wait = Math.max(0, this.opts.intervalMs - (this.now() - started));
		this.timer = setTimeout(() => void this.loop(), wait);
	}

	/** Run one collection round. Concurrent callers share the same round. */
	tick(): Promise<void> {
		this.ticking ??= this.collect().finally(() => (this.ticking = null));
		return this.ticking;
	}

	private snapshotDue(ledgerActivity: boolean): boolean {
		const since = this.now() - this.lastSnapshotStart;
		if (ledgerActivity && since >= this.opts.minSnapshotIntervalMs) return true;
		return since >= this.snapshotIntervalMs();
	}

	private async collect(): Promise<void> {
		const ledgerNew = this.opts.ledger ? await this.opts.ledger.poll() : 0;
		const due = this.snapshotDue(ledgerNew > 0);
		void this.opts.messenger?.reconcile().catch(() => {});
		const [ready, snap] = await Promise.all([
			this.opts.adapter.ready(),
			due ? this.readSnapshot() : Promise.resolve(null)
		]);
		if (ready.ok) {
			this.ready = ready.value;
			this.readyError = null;
		} else {
			this.ready = null;
			this.readyError = ready.error.message;
		}
		if (snap) await this.refreshEvidence(snap);
		this.rebuild();
		// Insights take titles from the fresh fleet view, then estimates join it.
		if (snap && this.opts.insights) {
			await this.refreshInsights(snap);
			this.rebuild();
		}
		void this.opts.insights?.pollUsage().catch(() => {});
		this.emit({ type: 'fleet', data: this.fleet! });
		this.emit({ type: 'health', data: this.health() });
		// After the fleet, so a page has the task an alert names.
		this.opts.bell?.observe(this.fleet!);
	}

	private async readSnapshot(): Promise<FleetSnapshot | null> {
		this.lastSnapshotStart = this.now();
		this.lastAttemptAt = this.lastSnapshotStart;
		const r = await this.opts.adapter.snapshot();
		this.lastSnapshotDuration = this.now() - this.lastSnapshotStart;
		if (!r.ok) {
			this.consecutiveFailures++;
			this.lastError = r.error.message;
			return null;
		}
		this.snapshot = r.value;
		this.lastSuccessAt = this.now();
		this.consecutiveFailures = 0;
		this.lastError = null;
		return r.value;
	}

	private dataDir(snap: FleetSnapshot): string {
		return snap.roots.data ?? `${this.opts.install.homeDir}/data`;
	}

	private async refreshEvidence(snap: FleetSnapshot): Promise<void> {
		const dataDir = this.dataDir(snap);
		if (this.opts.registry) {
			this.registry = await this.opts.registry(dataDir).catch(() => []);
		}
		const evidence = this.opts.evidence;
		if (!evidence) return;
		evidence.setDataDir(dataDir);
		const ledger = this.opts.ledger;
		const ids: { id: string; worktree: string | null; row: SnapshotTask | null }[] = [
			...snap.tasks.map((t) => ({
				id: t.id,
				worktree: t.worktree.present ? t.worktree.path : null,
				row: t
			})),
			...backlogOnly(snap).map(({ record }) => ({ id: record.id, worktree: null, row: null }))
		];
		const thumbs = new Map<string, Thumb>();
		const review = new Map<string, ReviewSignals>();
		const live = new Map<string, LiveSignals>();
		await Promise.all(
			ids.map(async ({ id, worktree, row }) => {
				const runs = ledger?.task(id)?.runIds ?? [];
				thumbs.set(
					id,
					await evidence.thumb(id, worktree, runs).catch(() => ({ kind: 'none' as const }))
				);
				const shots = await evidence.screenshots(id, runs).catch(() => []);
				review.set(id, {
					screenshots: shots.length,
					shots: shots
						.slice(0, CARD_SHOTS)
						.map((s) => ({ name: s.name, url: artifactUrl(id, s.name) })),
					...(row
						? await reviewChecks(evidence, row, ledger?.task(id) ?? null)
						: { ciChecks: 'unknown' as const, prDraft: null, prState: null })
				});
				if (row)
					live.set(
						id,
						await liveSignals(
							evidence,
							this.opts.build ?? null,
							row,
							worktree,
							ledger?.task(id) ?? null
						)
					);
			})
		);
		this.review = review;
		this.live = live;
		this.thumbs = thumbs;
	}

	/** Re-read the insights' inputs, with titles from the last fleet view. */
	private async refreshInsights(snap: FleetSnapshot): Promise<void> {
		const insights = this.opts.insights;
		const ledger = this.opts.ledger?.state().tasks;
		if (!insights || !ledger) return;
		insights.setDataDir(this.dataDir(snap));
		const live = new Set(snap.tasks.map((t) => t.id));
		const meta = new Map<string, TaskMeta>();
		for (const t of this.fleet?.tasks ?? []) {
			meta.set(t.id, {
				title: t.shortTitle,
				projectId: t.projectId,
				kind: t.kind,
				live: live.has(t.id)
			});
		}
		for (const t of snap.tasks) {
			if (!meta.has(t.id))
				meta.set(t.id, {
					title: t.backlog?.title ?? t.id,
					projectId: null,
					kind: t.kind,
					live: true
				});
		}
		await insights.refresh(ledger, meta).catch(() => {});
	}

	private rebuild(): void {
		const now = this.now();
		const ledgerTasks = this.opts.ledger?.state().tasks ?? new Map<string, LedgerTask>();
		const passages = this.opts.passages ?? null;
		const derived = this.snapshot
			? deriveTasks(this.snapshot, {
					registry: this.registry,
					thumbs: this.thumbs,
					review: this.review,
					live: this.live,
					ledger: ledgerTasks,
					stagesFor: passages?.stagesFor,
					nowSeconds: Math.floor(now / 1000)
				})
			: { tasks: [], projects: [] };
		const insights = this.opts.insights;
		if (insights) for (const t of derived.tasks) t.eta = insights.eta(t.id);
		for (const t of derived.tasks)
			t.build = buildHint(
				ledgerTasks.get(t.id) ?? null,
				this.live.get(t.id)?.docs ?? null,
				insights?.questionRounds(t.id) ?? []
			);
		if (passages) {
			passages.endRound(derived.projects.map((p) => p.id));
			for (const p of derived.projects) p.passage = passages.summary(p.id);
		}
		const age = this.lastSuccessAt === null ? null : now - this.lastSuccessAt;
		let staleReason: string | null = null;
		if (!this.snapshot) {
			staleReason = this.lastError
				? `Wheelhouse has not been able to read Firstmate yet: ${this.lastError}`
				: 'Wheelhouse has not read Firstmate yet.';
		} else if (this.consecutiveFailures > 0) {
			staleReason = `Wheelhouse could not read Firstmate for the last ${this.consecutiveFailures} ${
				this.consecutiveFailures === 1 ? 'check' : 'checks'
			}, so this may be out of date: ${this.lastError}`;
		} else if (age !== null && age > this.staleAfterMs()) {
			staleReason = `Firstmate was last read ${Math.round(age / 1000)} s ago.`;
		}
		this.fleet = {
			schema: 'wheelhouse-fleet.v1',
			generatedAt: this.snapshot?.generated ?? null,
			collectedAt: this.lastSuccessAt === null ? null : new Date(this.lastSuccessAt).toISOString(),
			stale: staleReason !== null,
			staleReason,
			projects: derived.projects,
			tasks: derived.tasks
		};
	}

	/** The cached view, with staleness recomputed for the current time. */
	getFleet(): FleetView {
		this.rebuild();
		return this.fleet!;
	}

	/** The raw snapshot row for a live task, if any. */
	row(id: string): SnapshotTask | null {
		return this.snapshot?.tasks.find((t) => t.id === id) ?? null;
	}

	ledgerTask(id: string): LedgerTask | null {
		return this.opts.ledger?.task(id) ?? null;
	}

	ledgerState(): { available: boolean; reason: string | null } {
		const s = this.opts.ledger?.state();
		return s ? { available: s.available, reason: s.reason } : { available: false, reason: null };
	}

	private supervisor(): Supervisor {
		const r = this.ready;
		if (!r) {
			return {
				available: false,
				onWatch: null,
				reason: this.readyError ?? 'Firstmate’s readiness has not been read yet.',
				observedAt: null,
				posture: null
			};
		}
		const onWatch = r.canReceive === true ? true : r.canReceive === false ? false : null;
		let reason: string | null = null;
		if (onWatch !== true) {
			if (r.lock.state !== 'held') reason = 'No Firstmate session is running in this home.';
			else if (r.wakeConsumer.state === 'down')
				reason = 'Firstmate’s session is running, but it is not picking up new work.';
			else reason = `Firstmate’s readiness is unclear (${r.wakeConsumer.reason ?? 'unknown'}).`;
		}
		return { available: true, onWatch, reason, observedAt: r.observedAt, posture: r.posture };
	}

	health(): Health {
		const c = this.opts.compatibility;
		const iso = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString());
		return {
			schema: 'wheelhouse-health.v1',
			version: this.opts.version,
			configured: true,
			firstmate: {
				dir: this.opts.install.firstmateDir,
				home: this.opts.install.homeDir,
				version: c.firstmateVersion,
				compatible: c.compatible,
				problems: c.problems,
				scripts: c.scripts.map((s) => ({
					name: s.name,
					purpose: s.purpose,
					ok: s.ok,
					problem: s.problem
				}))
			},
			supervisor: this.supervisor(),
			collector: {
				intervalMs: this.opts.intervalMs,
				snapshotIntervalMs: this.snapshotIntervalMs(),
				lastAttemptAt: iso(this.lastAttemptAt),
				lastSuccessAt: iso(this.lastSuccessAt),
				consecutiveFailures: this.consecutiveFailures,
				lastError: this.lastError
			},
			ledger: this.ledgerState(),
			messaging: this.messaging(),
			passages: this.opts.passages?.health() ?? {
				configDir: null,
				problem: 'Passage files are not set up.',
				checksRunning: 0
			}
		};
	}

	private messaging(): Messaging {
		const m = this.opts.messenger;
		if (!m) {
			return {
				available: false,
				reason: this.opts.messagingUnavailable ?? 'Messaging is not set up.',
				store: null
			};
		}
		return { available: m.available, reason: m.reason, store: m.storeFile };
	}

	subscribe(fn: (e: CollectorEvent) => void): () => void {
		this.listeners.add(fn);
		return () => this.listeners.delete(fn);
	}

	subscriberCount(): number {
		return this.listeners.size;
	}

	private emit(e: CollectorEvent): void {
		for (const fn of this.listeners) {
			try {
				fn(e);
			} catch {
				// a broken subscriber must not stop the collector
			}
		}
	}
}

const RUN_IN_DETAIL = /\brun: ([0-9A-Z]{26})\b/;

/**
 * Live progress for a live task: where the validation run crew state names
 * is (working, stopped at a gate, or finished, read in the task worktree),
 * how many files the worktree changes (the diff read is cached, and
 * shared with the card thumbnail), and the docs the session referenced
 * (the build reader's cached transcript touches and the same diff). The run is the one Firstmate's crew-state
 * read selected (its `run: <id>` component); Wheelhouse never picks a run.
 */
async function liveSignals(
	evidence: EvidenceReader,
	build: BuildReader | null,
	row: SnapshotTask,
	worktree: string | null,
	ledger: LedgerTask | null
): Promise<LiveSignals> {
	const cs = row.current;
	const runId =
		cs?.source === 'run-step' ? (RUN_IN_DETAIL.exec(cs.detail ?? '')?.[1] ?? null) : null;
	const [pipeline, diff] = await Promise.all([
		evidence.pipeline(runId, worktree).catch(() => null),
		worktree ? evidence.diff(worktree).catch(() => null) : Promise.resolve(null)
	]);
	const docs = build
		? await build
				.cardDocs(
					{
						id: row.id,
						branch: row.branch,
						worktree,
						dispatchedAt: ledger?.dispatched?.ts ?? null
					},
					diff?.available ? diff.value.files.map((f) => f.path) : null
				)
				.catch(() => null)
		: null;
	return {
		pipeline,
		filesChanged: diff?.available ? diff.value.total : null,
		docs
	};
}

/**
 * CI and PR facts for a live ship task whose PR may be waiting on the
 * captain: the CI monitor log of the run crew state names (while that run
 * is active and not fixing), and the PR's draft flag and state (cached reads),
 * read only when the task could be awaiting the merge.
 */
async function reviewChecks(
	evidence: EvidenceReader,
	row: SnapshotTask,
	ledger: LedgerTask | null
): Promise<Pick<ReviewSignals, 'ciChecks' | 'prDraft' | 'prState' | 'addressing'>> {
	const none = { ciChecks: 'unknown' as const, prDraft: null, prState: null };
	const prUrl = row.prUrl ?? ledger?.prReady?.pr ?? row.backlog?.prUrl ?? null;
	const cs = row.current;
	if (
		!prUrl ||
		(row.kind ?? row.backlog?.kind) === 'scout' ||
		(row.yolo ?? '').toLowerCase() === 'on' ||
		!cs ||
		!['done', 'working', 'paused'].includes(cs.state)
	) {
		return none;
	}
	const phase = runPhase(cs);
	if (phase === 'fixing') return none;
	const runId = phase ? (RUN_IN_DETAIL.exec(cs.detail ?? '')?.[1] ?? null) : null;
	const ciChecks = await evidence.ciChecks(runId).catch(() => 'unknown' as const);
	if (cs.state !== 'done' && ciChecks === 'not-ready') return { ...none, ciChecks };
	if (phase === 'running' && ciChecks !== 'green') return { ...none, ciChecks };
	const pr = await evidence.pr(row.id, prUrl).catch(() => null);
	const prDraft = pr?.available ? pr.value.draft : null;
	const prState = pr?.available ? pr.value.state : null;
	// A PR reported ready may since have the captain's review on it: read that only for an open, ready PR.
	const readyAt = ledger?.prReady?.pr === prUrl ? ledger.prReady.ts : null;
	const open = prDraft !== true && (!prState || prState.toLowerCase() === 'open');
	const addressing =
		readyAt !== null && open
			? addressingReview(readyAt, await evidence.prFeedback(prUrl).catch(() => null))
			: false;
	return { ciChecks, prDraft, prState, addressing };
}
