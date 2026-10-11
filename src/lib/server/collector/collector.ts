import type { FirstmateAdapter } from '../firstmate/adapter';
import type { FleetSnapshot, PrimaryReady, SnapshotTask } from '../firstmate/contracts';
import type { EvidenceReader } from '../firstmate/evidence';
import type { Compatibility } from '../firstmate/install';
import type { LedgerReader, LedgerTask } from '../firstmate/ledger';
import { backlogOnly, deriveTasks, type ProjectRegistryEntry } from '../firstmate/model';
import type { FleetView, Health, Supervisor, Thumb } from '../../types';

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
 */

export type CollectorEvent = { type: 'fleet'; data: FleetView } | { type: 'health'; data: Health };

export interface CollectorOptions {
	adapter: FirstmateAdapter;
	compatibility: Compatibility;
	install: { firstmateDir: string; homeDir: string };
	version: string;
	evidence?: EvidenceReader | null;
	ledger?: LedgerReader | null;
	/** Reads Firstmate's project registry; failures yield an empty list. */
	registry?: (dataDir: string) => Promise<ProjectRegistryEntry[]>;
	intervalMs?: number;
	minSnapshotIntervalMs?: number;
	maxSnapshotIntervalMs?: number;
	now?: () => number;
}

const DEFAULT_INTERVAL = 5_000;

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
	}

	private async loop(): Promise<void> {
		if (!this.running) return;
		const started = this.now();
		await this.tick();
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
		this.emit({ type: 'fleet', data: this.fleet! });
		this.emit({ type: 'health', data: this.health() });
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
		const ids: { id: string; worktree: string | null }[] = [
			...snap.tasks.map((t) => ({
				id: t.id,
				worktree: t.worktree.present ? t.worktree.path : null
			})),
			...backlogOnly(snap).map(({ record }) => ({ id: record.id, worktree: null }))
		];
		const thumbs = new Map<string, Thumb>();
		await Promise.all(
			ids.map(async ({ id, worktree }) => {
				const runs = ledger?.task(id)?.runIds ?? [];
				thumbs.set(
					id,
					await evidence.thumb(id, worktree, runs).catch(() => ({ kind: 'none' as const }))
				);
			})
		);
		this.thumbs = thumbs;
	}

	private rebuild(): void {
		const now = this.now();
		const ledgerTasks = this.opts.ledger?.state().tasks ?? new Map<string, LedgerTask>();
		const derived = this.snapshot
			? deriveTasks(this.snapshot, {
					registry: this.registry,
					thumbs: this.thumbs,
					ledger: ledgerTasks,
					nowSeconds: Math.floor(now / 1000)
				})
			: { tasks: [], projects: [] };
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
			ledger: this.ledgerState()
		};
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
