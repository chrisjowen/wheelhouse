import { subscribe } from 'node:diagnostics_channel';
import { loadavg } from 'node:os';
import { constants, monitorEventLoopDelay, PerformanceObserver } from 'node:perf_hooks';
import { getHeapStatistics } from 'node:v8';
import type { ProcessVitals } from '../../soundings';
import type { VitalsPoint } from './rules';
import { openStreams, trackedFeeds, type TrackedFeed } from './counters';

/**
 * Wheelhouse's own server process, as Soundings sees it, and the process
 * block of /api/health: memory (with the heap as it stands after the last
 * full garbage collection, and the physical footprint the last scan read,
 * which unlike RSS leaves out shared and reclaimable pages), the event loop's
 * delay, the streams and chat followers open, how many child processes it
 * starts a minute, how long the last fleet snapshot took, and this computer's
 * load. Measuring costs almost nothing, so it runs whether or not Soundings
 * is on; one per process (on globalThis, so Vite's module reloading does not
 * start a second).
 *
 * Once a minute it keeps a reading (VitalsPoint) for the rules that need a
 * condition to last (event loop, snapshot), and, while Soundings is on, closes
 * chat followers that no page has listened to for ten minutes yet still
 * watch their file: the one thing Soundings ever does on its own, and only to
 * Wheelhouse itself.
 */

/** How long a chat follower may watch with no page listening before it is closed. */
export const ORPHAN_AFTER_MS = 10 * 60_000;
/** How long the once-a-minute readings are kept. */
const KEEP_MS = 3 * 3600_000;
/** Spawn times kept for the per-minute rate (a runaway beyond this still reads as this many). */
const SPAWN_CAP = 10_000;

interface VitalsState {
	started: boolean;
	loop: ReturnType<typeof monitorEventLoopDelay> | null;
	/** p99 over the last finished minute (the histogram restarts each minute). */
	lastP99Ms: number;
	postGcHeap: number | null;
	spawns: number[];
	footprint: number | null;
	points: VitalsPoint[];
	orphanSince: WeakMap<TrackedFeed, number>;
	orphansClosed: number;
	timer: ReturnType<typeof setInterval> | null;
	snapshot: () => { lastDurationMs: number | null; inFlightMs: number | null };
	tidy: () => boolean;
}

const KEY = Symbol.for('wheelhouse.soundings.vitals');
const g = globalThis as unknown as Record<symbol, VitalsState | undefined>;

function state(): VitalsState {
	return (g[KEY] ??= {
		started: false,
		loop: null,
		lastP99Ms: 0,
		postGcHeap: null,
		spawns: [],
		footprint: null,
		points: [],
		orphanSince: new WeakMap(),
		orphansClosed: 0,
		timer: null,
		snapshot: () => ({ lastDurationMs: null, inFlightMs: null }),
		tidy: () => false
	});
}

const nsToMs = (ns: number) => (Number.isFinite(ns) ? Math.round(ns / 1e5) / 10 : 0);

/**
 * Start measuring: the event loop's delay, full GCs and child process starts,
 * and a reading every minute. `snapshot` gives the fleet snapshot's timing;
 * `tidy` says whether orphaned chat followers may be closed (Soundings is on).
 * Idempotent, apart from taking the newest `snapshot` and `tidy`.
 */
export function startVitals(
	o: {
		snapshot?: VitalsState['snapshot'];
		tidy?: () => boolean;
	} = {}
): void {
	const s = state();
	if (o.snapshot) s.snapshot = o.snapshot;
	if (o.tidy) s.tidy = o.tidy;
	if (s.started) return;
	s.started = true;
	s.loop = monitorEventLoopDelay({ resolution: 20 });
	s.loop.enable();
	try {
		const gc = new PerformanceObserver((list) => {
			for (const e of list.getEntries()) {
				const kind = (e as { detail?: { kind?: number } }).detail?.kind;
				if (kind === constants.NODE_PERFORMANCE_GC_MAJOR)
					s.postGcHeap = getHeapStatistics().used_heap_size;
			}
		});
		gc.observe({ entryTypes: ['gc'] });
	} catch {
		// no GC entries on this runtime: post-GC heap stays unknown
	}
	// Every ChildProcess Node starts is published here (execFile, spawn, fork, exec).
	subscribe('child_process', () => {
		s.spawns.push(Date.now());
		if (s.spawns.length > SPAWN_CAP) s.spawns.splice(0, s.spawns.length - SPAWN_CAP);
	});
	s.timer = setInterval(() => minute(), 60_000);
	s.timer.unref?.();
}

export function stopVitals(): void {
	const s = state();
	if (s.timer) clearInterval(s.timer);
	s.loop?.disable();
	g[KEY] = undefined;
}

/** The physical footprint the last scan read (the probe measures it, off this process). */
export function setFootprint(bytes: number | null): void {
	state().footprint = bytes;
}

/** The once-a-minute readings, oldest first. */
export function vitalsHistory(): VitalsPoint[] {
	return [...state().points];
}

/** Chat followers Soundings has closed since the server started. */
export function orphansClosed(): number {
	return state().orphansClosed;
}

/** One minute's reading; the event loop's histogram starts again. Exported for tests. */
export function minute(now = Date.now(), feeds: () => TrackedFeed[] = trackedFeeds): VitalsPoint {
	const s = state();
	if (s.loop) {
		s.lastP99Ms = nsToMs(s.loop.percentile(99));
		s.loop.reset();
	}
	const t = s.snapshot();
	const point: VitalsPoint = {
		at: now,
		eventLoopP99Ms: s.lastP99Ms,
		lastSnapshotMs: snapshotMs(t)
	};
	s.points.push(point);
	const first = s.points.findIndex((p) => now - p.at <= KEEP_MS);
	if (first > 0) s.points.splice(0, first);
	closeOrphans(now, feeds);
	return point;
}

/** The slower of the last snapshot and one still running (a hung snapshot counts). */
function snapshotMs(t: {
	lastDurationMs: number | null;
	inFlightMs: number | null;
}): number | null {
	if (t.lastDurationMs === null && t.inFlightMs === null) return null;
	return Math.max(t.lastDurationMs ?? 0, t.inFlightMs ?? 0);
}

function orphaned(f: TrackedFeed): boolean {
	return f.listening === 0 && f.watching;
}

/** Close chat followers orphaned for ORPHAN_AFTER_MS, while Soundings is on. */
function closeOrphans(now: number, feeds: () => TrackedFeed[]): void {
	const s = state();
	for (const f of feeds()) {
		if (!orphaned(f)) {
			s.orphanSince.delete(f);
			continue;
		}
		const since = s.orphanSince.get(f) ?? now;
		s.orphanSince.set(f, since);
		if (now - since >= ORPHAN_AFTER_MS && s.tidy()) {
			f.stop();
			s.orphanSince.delete(f);
			s.orphansClosed++;
			console.log('Soundings: closed a chat follower no page had listened to for 10 minutes.');
		}
	}
}

/** Wheelhouse's process now. */
export function currentVitals(
	now = Date.now(),
	feeds: () => TrackedFeed[] = trackedFeeds
): ProcessVitals {
	const s = state();
	const mem = process.memoryUsage();
	const since = now - 60_000;
	const first = s.spawns.findIndex((t) => t >= since);
	if (first > 0) s.spawns.splice(0, first);
	else if (first === -1) s.spawns.length = 0;
	const all = feeds();
	const live = s.loop ? nsToMs(s.loop.percentile(99)) : 0;
	return {
		at: new Date(now).toISOString(),
		pid: process.pid,
		uptimeSeconds: Math.round(process.uptime()),
		rssBytes: mem.rss,
		heapUsedBytes: mem.heapUsed,
		postGcHeapBytes: s.postGcHeap,
		footprintBytes: s.footprint,
		// The worse of the last full minute and the minute so far.
		eventLoopP99Ms: Math.max(s.lastP99Ms, live),
		streams: openStreams(),
		chatFeeds: {
			count: all.length,
			listening: all.filter((f) => f.listening > 0).length,
			watchers: all.filter((f) => f.watching).length,
			orphans: all.filter(orphaned).length
		},
		childrenPerMinute: s.spawns.length,
		lastSnapshotMs: snapshotMs(s.snapshot()),
		load: loadavg().map((x) => Math.round(x * 100) / 100) as [number, number, number]
	};
}
