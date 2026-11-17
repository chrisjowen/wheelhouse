import type { AlertDraft } from '../../bell';
import type { ProcessCheck, ProcessHealth } from '../../types';
import { DEFAULT_HEALTH_CONFIG, type HealthConfig } from './config';
import {
	openStreams,
	remoteReadP50,
	remoteReads,
	trackedFeeds,
	type TrackedFeed
} from './counters';
import { describeHeavy, type CrewWorktree, type HeavyProcess } from './heavy';
import type { HistorySizes } from './history';
import type { ProcessSample } from './process';

/**
 * Wheelhouse's background health check. Every `sampleSeconds` it samples its
 * own process (process.ts) and runs these checks, each over a threshold in
 * health.json (config.ts):
 *
 * - snapshot-lag: the fleet snapshot takes longer than snapshotLagSeconds for
 *   snapshotLagMinutes: the bell says the fleet view lags (notify only).
 * - event-loop: the loop's p99 delay is over eventLoopP99Ms for
 *   eventLoopMinutes: the bell rings, and the heap and handle counts are logged.
 * - heap: the heap after a full GC is over heapMb, or grew heapGrowthMb within
 *   heapGrowthHours: Wheelhouse restarts its own server (the CLI's watcher
 *   starts it again on the same port; see cli/supervise.ts), only once nothing
 *   is in progress (`idle`), at most once an hour, and only under the watcher.
 * - orphan-feeds: a chat follower no page listens to that still holds a file
 *   watcher for orphanFeedMinutes is stopped (its watcher closed).
 * - load: this computer's load is over loadPerCpu x its CPUs for loadMinutes:
 *   the bell names the heaviest processes, crew tasks' first (notify only).
 * - remote-slow: a remote second mate whose reads' median is over
 *   remoteReadP50Seconds shows "remote host slow" on its card (`remoteSlow`).
 * - history: data/, handled notes or the chat archive over their thresholds:
 *   the bell proposes archiving to the captain. It never archives anything.
 *
 * It never restarts or stops Firstmate or a crew session, never deletes
 * anything and never changes the crew's concurrency: the only thing it acts on
 * is Wheelhouse's own server, and its own idle chat followers.
 */

export interface HealthMonitorDeps {
	config: () => Promise<HealthConfig>;
	sample: (now: number) => Promise<ProcessSample>;
	/** The fleet snapshot: the last one's duration and the running one's time so far. */
	snapshot: () => { lastDurationMs: number | null; inFlightMs: number | null };
	/** Ring the ship's bell (each id once), and settle an alert once its moment has passed. */
	ring: (draft: AlertDraft) => void;
	settle: (id: string) => void;
	log: (line: string) => void;
	/** The heap and handle counts, logged when the event loop is slow. */
	heapAndHandles: () => string;
	/** What restarting Wheelhouse's server now would interrupt; empty when nothing would. */
	inProgress: () => Promise<string[]>;
	/** Wheelhouse's server runs under the CLI's watcher, so it can restart itself. */
	canRestart: () => boolean;
	/** Restart Wheelhouse's own server; false when it runs without the CLI's watcher. */
	restart: () => boolean;
	/** The chat followers to look at (counters.ts by default). */
	feeds?: () => TrackedFeed[];
	/** Crew tasks' worktrees, to name the processes working in them. */
	crew: () => CrewWorktree[];
	heaviest: (crew: CrewWorktree[]) => Promise<HeavyProcess[]>;
	history: () => Promise<HistorySizes>;
	now?: () => number;
}

type CheckId = ProcessCheck['id'];

interface CheckState {
	/** When the condition was first seen true in this run of it; null when false. */
	since: number | null;
	/** The bell alert raised for this run, if any. */
	alertId: string | null;
	detail: string | null;
}

const MIN = 60_000;
const HOUR = 60 * MIN;
const MB = 1024 * 1024;
/** The heap settles after start: growth is measured only from this much uptime on. */
const HEAP_WARMUP_MS = 30 * MIN;
const CHECK_IDS: CheckId[] = [
	'snapshot-lag',
	'event-loop',
	'heap',
	'orphan-feeds',
	'load',
	'remote-slow',
	'history'
];

const fmtMb = (mb: number) =>
	mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`;
const secs = (ms: number) => `${Math.round(ms / 100) / 10} s`;

export class HealthMonitor {
	private deps: HealthMonitorDeps;
	private now: () => number;
	private cfg: HealthConfig = { ...DEFAULT_HEALTH_CONFIG };
	private last: ProcessSample | null = null;
	private checks = new Map<CheckId, CheckState>(
		CHECK_IDS.map((id) => [id, { since: null, alertId: null, detail: null }])
	);
	/** Post-GC heap over time (after warm-up), for the growth check. */
	private heap: { at: number; mb: number }[] = [];
	/** When each orphaned chat follower was first seen orphaned. */
	private orphanSince = new WeakMap<TrackedFeed, number>();
	private restartAsked = false;
	private history: (HistorySizes & { at: number }) | null = null;
	/** When history was last measured; null until the first round. */
	private historyAt: number | null = null;
	private timer: ReturnType<typeof setTimeout> | null = null;
	private running = false;
	private ticking: Promise<void> | null = null;

	constructor(deps: HealthMonitorDeps) {
		this.deps = deps;
		this.now = deps.now ?? Date.now;
	}

	start(): void {
		if (this.running) return;
		this.running = true;
		const loop = async () => {
			if (!this.running) return;
			await this.tick().catch((e) => this.deps.log(`Health check failed: ${String(e)}`));
			if (!this.running) return;
			this.timer = setTimeout(() => void loop(), this.cfg.sampleSeconds * 1000);
			this.timer.unref?.();
		};
		void loop();
	}

	stop(): void {
		this.running = false;
		if (this.timer) clearTimeout(this.timer);
		this.timer = null;
	}

	/** Sample and run every check once. Overlapping calls share one round. */
	tick(): Promise<void> {
		this.ticking ??= this.round().finally(() => (this.ticking = null));
		return this.ticking;
	}

	private async round(): Promise<void> {
		this.cfg = await this.deps.config();
		const now = this.now();
		const s = await this.deps.sample(now);
		this.last = s;
		if (!this.cfg.enabled) {
			for (const id of CHECK_IDS) this.update(id, false, now, null);
			return;
		}
		this.checkSnapshot(now);
		this.checkEventLoop(s, now);
		await this.checkHeap(s, now);
		this.checkOrphans(now);
		await this.checkLoad(s, now);
		this.checkRemote(now);
		await this.checkHistory(now);
	}

	/**
	 * Note whether a check's condition holds; returns true once it has held for
	 * `forMs` (and was not already firing), so the caller acts once per run.
	 * A condition that clears settles the run's alert.
	 */
	private update(id: CheckId, holds: boolean, now: number, detail: string | null, forMs = 0) {
		const c = this.checks.get(id)!;
		c.detail = holds ? detail : null;
		if (!holds) {
			if (c.alertId) this.deps.settle(c.alertId);
			c.since = null;
			c.alertId = null;
			return false;
		}
		c.since ??= now;
		return !c.alertId && now - c.since >= forMs;
	}

	private fire(id: CheckId, draft: Omit<AlertDraft, 'id' | 'kind' | 'taskId' | 'projectId'>) {
		const c = this.checks.get(id)!;
		c.alertId = `wheelhouse:${id}:${c.since}`;
		this.deps.ring({ ...draft, id: c.alertId, kind: 'wheelhouse', taskId: null, projectId: null });
	}

	private checkSnapshot(now: number): void {
		const { lastDurationMs, inFlightMs } = this.deps.snapshot();
		const ms = Math.max(lastDurationMs ?? 0, inFlightMs ?? 0);
		const over = ms > this.cfg.snapshotLagSeconds * 1000;
		if (
			this.update(
				'snapshot-lag',
				over,
				now,
				`snapshot ${secs(ms)}`,
				this.cfg.snapshotLagMinutes * MIN
			)
		)
			this.fire('snapshot-lag', {
				title: 'Wheelhouse',
				text: `The fleet view lags ${Math.round(ms / 1000)} s: Firstmate's fleet snapshot has taken over ${this.cfg.snapshotLagSeconds} s for ${this.cfg.snapshotLagMinutes} min, so what Wheelhouse shows is that far behind.`,
				captain: false,
				actions: []
			});
	}

	private checkEventLoop(s: ProcessSample, now: number): void {
		const p99 = s.eventLoop.p99Ms;
		const over = p99 > this.cfg.eventLoopP99Ms;
		if (
			this.update(
				'event-loop',
				over,
				now,
				`p99 ${Math.round(p99)} ms`,
				this.cfg.eventLoopMinutes * MIN
			)
		) {
			this.deps.log(
				`Wheelhouse's event loop p99 delay is ${Math.round(p99)} ms (over ${this.cfg.eventLoopP99Ms} ms for ${this.cfg.eventLoopMinutes} min): ${this.deps.heapAndHandles()}`
			);
			this.fire('event-loop', {
				title: 'Wheelhouse',
				text: `Wheelhouse's server is slow to respond: its event loop has stalled up to ${Math.round(p99)} ms (p99) for ${this.cfg.eventLoopMinutes} min. Its heap and handle counts are in its log.`,
				captain: false,
				actions: []
			});
		}
	}

	private async checkHeap(s: ProcessSample, now: number): Promise<void> {
		const heapMb = s.postGcHeapMb;
		const uptimeMs = s.uptimeSeconds * 1000;
		let reason: string | null = null;
		if (heapMb !== null) {
			if (uptimeMs >= HEAP_WARMUP_MS) {
				this.heap.push({ at: now, mb: heapMb });
				const since = now - this.cfg.heapGrowthHours * HOUR;
				this.heap = this.heap.filter((h) => h.at >= since);
			}
			const low = this.heap.length ? Math.min(...this.heap.map((h) => h.mb)) : heapMb;
			if (heapMb > this.cfg.heapMb)
				reason = `holds ${fmtMb(heapMb)} of heap after garbage collection (over ${fmtMb(this.cfg.heapMb)})`;
			else if (heapMb - low >= this.cfg.heapGrowthMb)
				reason = `heap after garbage collection grew ${fmtMb(heapMb - low)} within ${this.cfg.heapGrowthHours} h (to ${fmtMb(heapMb)})`;
		}
		const first = this.update('heap', reason !== null, now, reason);
		if (reason === null) return;
		if (first)
			this.fire('heap', {
				title: 'Wheelhouse',
				text: this.deps.canRestart()
					? `Wheelhouse's server ${reason}. It restarts itself to free the memory once nothing is in progress; Firstmate and the crew are untouched.`
					: `Wheelhouse's server ${reason}. Restarting Wheelhouse frees the memory; Firstmate and the crew are untouched.`,
				captain: false,
				actions: []
			});
		if (this.restartAsked || uptimeMs < this.cfg.restartMinUptimeMinutes * MIN) return;
		const busy = await this.deps.inProgress();
		if (busy.length) {
			this.checks.get('heap')!.detail = `${reason}; restart waits for: ${busy.join(', ')}`;
			return;
		}
		if (this.deps.restart()) {
			this.restartAsked = true;
			this.deps.log(
				`Restarting Wheelhouse's server: it ${reason}. Firstmate and its crew are untouched.`
			);
		} else {
			this.checks.get('heap')!.detail =
				`${reason}; not under the CLI's watcher, so restart Wheelhouse by hand`;
		}
	}

	private checkOrphans(now: number): void {
		const limit = this.cfg.orphanFeedMinutes * MIN;
		let orphans = 0;
		let closed = 0;
		for (const f of (this.deps.feeds ?? trackedFeeds)()) {
			if (f.listening > 0 || !f.watching) {
				this.orphanSince.delete(f);
				continue;
			}
			const since = this.orphanSince.get(f) ?? now;
			this.orphanSince.set(f, since);
			if (now - since >= limit) {
				f.stop();
				this.orphanSince.delete(f);
				closed++;
			} else orphans++;
		}
		if (closed)
			this.deps.log(
				`Closed ${closed} chat follower${closed === 1 ? '' : 's'} no page had listened to for ${this.cfg.orphanFeedMinutes} min.`
			);
		this.update('orphan-feeds', orphans > 0, now, orphans ? `${orphans} orphaned` : null);
	}

	private async checkLoad(s: ProcessSample, now: number): Promise<void> {
		const limit = this.cfg.loadPerCpu * s.load.cpus;
		const over = s.load.avg1 > limit;
		const detail = `load ${s.load.avg1} on ${s.load.cpus} CPUs`;
		if (!this.update('load', over, now, detail, this.cfg.loadMinutes * MIN)) return;
		const heavy = await this.deps.heaviest(this.deps.crew()).catch(() => []);
		const named = describeHeavy(heavy);
		this.fire('load', {
			title: 'Wheelhouse',
			text: `This computer is overloaded: load ${s.load.avg1} on ${s.load.cpus} CPUs for ${this.cfg.loadMinutes} min.${named ? ` Heaviest: ${named}.` : ''}`,
			captain: false,
			actions: []
		});
		this.checks.get('load')!.detail = named ? `${detail}; heaviest: ${named}` : detail;
	}

	/** "Remote host slow (reads take about 4.2 s)" for a remote second mate, or null. */
	remoteSlow(mateId: string): string | null {
		if (!this.cfg.enabled) return null;
		const p50 = remoteReadP50(mateId, this.now());
		return p50 !== null && p50 > this.cfg.remoteReadP50Seconds * 1000
			? `Remote host slow: reads take about ${secs(p50)}`
			: null;
	}

	private checkRemote(now: number): void {
		const slow = remoteReads(now)
			.filter((r) => this.remoteSlow(r.mate))
			.map((r) => `${r.mate} ${secs(r.p50Ms)}`);
		this.update('remote-slow', slow.length > 0, now, slow.join(', ') || null);
	}

	private async checkHistory(now: number): Promise<void> {
		const every = this.cfg.historyCheckHours * HOUR;
		// First measured a while after start, not while the server is busiest starting.
		this.historyAt ??= now - every + Math.min(10 * MIN, every);
		if (now - this.historyAt >= every) {
			this.historyAt = now;
			this.history = { ...(await this.deps.history()), at: now };
		}
		const h = this.history;
		if (!h) return;
		const over: string[] = [];
		const dataMb = h.dataBytes === null ? null : h.dataBytes / MB;
		const archiveMb = h.chatArchiveBytes === null ? null : h.chatArchiveBytes / MB;
		if (dataMb !== null && dataMb > this.cfg.dataMb)
			over.push(`Firstmate's data/ folder is ${fmtMb(dataMb)} (over ${fmtMb(this.cfg.dataMb)})`);
		if (h.handledNotes !== null && h.handledNotes > this.cfg.handledNotes)
			over.push(`${h.handledNotes} handled inbox notes (over ${this.cfg.handledNotes})`);
		if (archiveMb !== null && archiveMb > this.cfg.chatArchiveMb)
			over.push(`the chat archive is ${fmtMb(archiveMb)} (over ${fmtMb(this.cfg.chatArchiveMb)})`);
		if (this.update('history', over.length > 0, now, over.join('; ') || null))
			this.fire('history', {
				title: 'Wheelhouse',
				text: `History has grown large: ${over.join('; ')}. Archiving older records would keep reads quick. Wheelhouse only proposes this; it never moves or deletes anything.`,
				captain: true,
				actions: []
			});
	}

	/** The process block of /api/health; null before the first sample. */
	block(): ProcessHealth | null {
		const s = this.last;
		if (!s) return null;
		const feeds = (this.deps.feeds ?? trackedFeeds)();
		const iso = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString());
		const h = this.history;
		const toMb = (b: number | null) => (b === null ? null : Math.round((b / MB) * 10) / 10);
		return {
			sampledAt: new Date(s.at).toISOString(),
			pid: process.pid,
			uptimeSeconds: s.uptimeSeconds,
			memory: {
				rssMb: s.rssMb,
				heapUsedMb: s.heapUsedMb,
				postGcHeapMb: s.postGcHeapMb,
				footprintMb: s.footprintMb
			},
			eventLoop: s.eventLoop,
			sseStreams: openStreams(),
			chatFeeds: {
				count: feeds.length,
				watching: feeds.filter((f) => f.watching).length,
				orphaned: feeds.filter((f) => f.watching && f.listening === 0).length
			},
			spawnsPerMinute: s.spawnsPerMinute,
			spawnsTotal: s.spawnsTotal,
			snapshot: this.deps.snapshot(),
			load: s.load,
			remoteReads: remoteReads(this.now()),
			history: h
				? {
						measuredAt: new Date(h.at).toISOString(),
						dataMb: toMb(h.dataBytes),
						handledNotes: h.handledNotes,
						chatArchiveMb: toMb(h.chatArchiveBytes)
					}
				: null,
			checks: CHECK_IDS.map((id) => {
				const c = this.checks.get(id)!;
				return {
					id,
					// remote-slow acts by showing on the mate's card, at once.
					state: c.since === null ? 'ok' : c.alertId || id === 'remote-slow' ? 'firing' : 'pending',
					since: iso(c.since),
					detail: c.detail
				};
			})
		};
	}
}
