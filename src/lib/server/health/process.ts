import { subscribe } from 'node:diagnostics_channel';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { availableParallelism, loadavg } from 'node:os';
import { constants, monitorEventLoopDelay, PerformanceObserver } from 'node:perf_hooks';
import { getHeapStatistics } from 'node:v8';

/**
 * Wheelhouse's own process, as the health check sees it: memory (with the
 * heap as it stands after the last full garbage collection, and the physical
 * footprint, which unlike RSS leaves out shared and reclaimable pages), the
 * event loop's delay, how many child processes it starts a minute, and this
 * computer's load. One probe per process (on globalThis, so Vite's module
 * reloading does not start a second), started on first use.
 */

const MB = 1024 * 1024;
const mb = (bytes: number) => Math.round((bytes / MB) * 10) / 10;

export interface ProcessSample {
	at: number;
	uptimeSeconds: number;
	rssMb: number;
	heapUsedMb: number;
	/** Heap in use right after the last full (mark-compact) GC; null until one ran. */
	postGcHeapMb: number | null;
	/** Physical footprint (macOS) or private dirty memory plus swap (Linux); null when unknown. */
	footprintMb: number | null;
	/** Event loop delay over the window since the last sample. */
	eventLoop: { p50Ms: number; p99Ms: number; maxMs: number };
	/** Child processes started in the last minute, and since the server started. */
	spawnsPerMinute: number;
	spawnsTotal: number;
	load: { avg1: number; avg5: number; avg15: number; cpus: number };
}

interface ProbeState {
	started: boolean;
	loop: ReturnType<typeof monitorEventLoopDelay> | null;
	postGcHeap: number | null;
	spawns: number[];
	spawnsTotal: number;
	footprint: number | null;
	footprintAt: number;
}

const KEY = Symbol.for('wheelhouse.health.probe');
const g = globalThis as unknown as Record<symbol, ProbeState | undefined>;
/** Spawn times kept for the per-minute rate (a runaway beyond this still reads as this many). */
const SPAWN_CAP = 10_000;
/** How often the footprint is read again (on macOS it takes a vmmap run). */
const FOOTPRINT_EVERY_MS = 5 * 60_000;

function state(): ProbeState {
	return (g[KEY] ??= {
		started: false,
		loop: null,
		postGcHeap: null,
		spawns: [],
		spawnsTotal: 0,
		footprint: null,
		footprintAt: 0
	});
}

/** Start measuring: the event loop's delay, full GCs and child process starts. Idempotent. */
export function startProbe(): void {
	const s = state();
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
		s.spawnsTotal++;
		s.spawns.push(Date.now());
		if (s.spawns.length > SPAWN_CAP) s.spawns.splice(0, s.spawns.length - SPAWN_CAP);
	});
}

/** Linux: private dirty memory plus swap, from /proc/self/smaps_rollup (in bytes). */
export function parseSmapsRollup(text: string): number | null {
	let kb = 0;
	let found = false;
	for (const line of text.split('\n')) {
		const m = /^(Private_Dirty|SwapPss):\s+(\d+)\s+kB/.exec(line);
		if (m) {
			kb += Number(m[2]);
			found = true;
		}
	}
	return found ? kb * 1024 : null;
}

/** macOS: `vmmap -summary`'s "Physical footprint" line (in bytes). */
export function parseVmmapFootprint(text: string): number | null {
	const m = /^Physical footprint:\s+([\d.]+)\s*([KMGT])?B?/m.exec(text);
	if (!m) return null;
	const unit = { K: 1024, M: MB, G: 1024 * MB, T: 1024 * 1024 * MB }[m[2] ?? ''] ?? 1;
	return Math.round(Number(m[1]) * unit);
}

async function readFootprint(): Promise<number | null> {
	if (process.platform === 'linux') {
		return parseSmapsRollup(await readFile('/proc/self/smaps_rollup', 'utf8').catch(() => ''));
	}
	if (process.platform === 'darwin') {
		const out = await new Promise<string>((resolve) =>
			execFile(
				'vmmap',
				['-summary', String(process.pid)],
				{ timeout: 10_000, maxBuffer: 4 * MB },
				(_e, stdout) => resolve(String(stdout ?? ''))
			)
		);
		return parseVmmapFootprint(out);
	}
	return null;
}

/** Take a sample; the event loop window starts again. */
export async function sampleProcess(now = Date.now()): Promise<ProcessSample> {
	startProbe();
	const s = state();
	if (now - s.footprintAt >= FOOTPRINT_EVERY_MS || s.footprint === null) {
		s.footprintAt = now;
		s.footprint = await readFootprint().catch(() => null);
	}
	const mem = process.memoryUsage();
	const loop = s.loop!;
	const ms = (ns: number) => (Number.isFinite(ns) ? Math.round(ns / 1e5) / 10 : 0);
	const eventLoop = {
		p50Ms: ms(loop.percentile(50)),
		p99Ms: ms(loop.percentile(99)),
		maxMs: ms(loop.max)
	};
	loop.reset();
	const since = now - 60_000;
	const first = s.spawns.findIndex((t) => t >= since);
	if (first > 0) s.spawns.splice(0, first);
	else if (first === -1) s.spawns.length = 0;
	const [avg1, avg5, avg15] = loadavg().map((x) => Math.round(x * 100) / 100);
	return {
		at: now,
		uptimeSeconds: Math.round(process.uptime()),
		rssMb: mb(mem.rss),
		heapUsedMb: mb(mem.heapUsed),
		postGcHeapMb: s.postGcHeap === null ? null : mb(s.postGcHeap),
		footprintMb: s.footprint === null ? null : mb(s.footprint),
		eventLoop,
		spawnsPerMinute: s.spawns.length,
		spawnsTotal: s.spawnsTotal,
		load: { avg1, avg5, avg15, cpus: availableParallelism() }
	};
}

/** The heap and handle counts logged when the event loop is slow. */
export function heapAndHandles(): string {
	const h = getHeapStatistics();
	const counts = new Map<string, number>();
	for (const r of process.getActiveResourcesInfo()) counts.set(r, (counts.get(r) ?? 0) + 1);
	const handles = [...counts]
		.sort((a, b) => b[1] - a[1])
		.map(([k, n]) => `${k}=${n}`)
		.join(' ');
	return `heap used ${mb(h.used_heap_size)} MB of ${mb(h.total_heap_size)} MB (limit ${mb(h.heap_size_limit)} MB), external ${mb(process.memoryUsage().external)} MB; active resources: ${handles || 'none'}`;
}
