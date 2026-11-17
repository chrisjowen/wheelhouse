import { afterEach, describe, expect, it } from 'vitest';
import type { AlertDraft } from '../../bell';
import { DEFAULT_HEALTH_CONFIG, parseHealthConfig, type HealthConfig } from './config';
import { recordRemoteRead, resetCounters, type TrackedFeed } from './counters';
import { HealthMonitor, type HealthMonitorDeps } from './monitor';
import type { ProcessSample } from './process';
import type { HeavyProcess } from './heavy';

const MIN = 60_000;
const T0 = Date.parse('2026-11-17T10:00:00Z');

function sample(over: Partial<ProcessSample> = {}): ProcessSample {
	return {
		at: 0,
		uptimeSeconds: 7200,
		rssMb: 300,
		heapUsedMb: 120,
		postGcHeapMb: 100,
		footprintMb: 150,
		eventLoop: { p50Ms: 10, p99Ms: 20, maxMs: 30 },
		spawnsPerMinute: 4,
		spawnsTotal: 40,
		load: { avg1: 1, avg5: 1, avg15: 1, cpus: 4 },
		...over
	};
}

function feed(listening: number, watching: boolean): TrackedFeed & { stopped: number } {
	const f = {
		listening,
		watching,
		stopped: 0,
		stop() {
			f.stopped++;
			f.watching = false;
		}
	};
	return f;
}

function harness(cfg: Partial<HealthConfig> = {}, deps: Partial<HealthMonitorDeps> = {}) {
	const clock = { t: T0 };
	const state = {
		sample: sample(),
		snapshot: { lastDurationMs: 2_000 as number | null, inFlightMs: null as number | null },
		busy: [] as string[],
		canRestart: true,
		feeds: [] as TrackedFeed[],
		heavy: [] as HeavyProcess[],
		history: { dataBytes: 10 * 1024 * 1024, handledNotes: 10, chatArchiveBytes: 1024 }
	};
	const rung: AlertDraft[] = [];
	const settled: string[] = [];
	const logs: string[] = [];
	const restarts: number[] = [];
	const config = { ...DEFAULT_HEALTH_CONFIG, ...cfg };
	const monitor = new HealthMonitor({
		config: async () => config,
		sample: async (now) => ({ ...state.sample, at: now }),
		snapshot: () => state.snapshot,
		ring: (d) => rung.push(d),
		settle: (id) => settled.push(id),
		log: (l) => logs.push(l),
		heapAndHandles: () => 'heap used 90 MB; active resources: Timeout=3 FSReqCallback=1',
		inProgress: async () => state.busy,
		canRestart: () => state.canRestart,
		restart: () => {
			restarts.push(clock.t);
			return state.canRestart;
		},
		feeds: () => state.feeds,
		crew: () => [{ taskId: 'fix-login', worktree: '/work/fix-login' }],
		heaviest: async () => state.heavy,
		history: async () => state.history,
		now: () => clock.t,
		...deps
	});
	/** Run one round every `stepMs` for `forMs`. */
	const run = async (forMs: number, stepMs = 30_000) => {
		for (let t = 0; t <= forMs; t += stepMs) {
			await monitor.tick();
			clock.t += stepMs;
		}
	};
	const check = (id: string) => monitor.block()!.checks.find((c) => c.id === id)!;
	return { clock, state, rung, settled, logs, restarts, monitor, run, check };
}

afterEach(() => resetCounters());

describe('health config', () => {
	it('keeps defaults for anything missing or unusable, and takes positive numbers', () => {
		expect(parseHealthConfig(null)).toEqual(DEFAULT_HEALTH_CONFIG);
		const c = parseHealthConfig({
			heapMb: 50,
			loadPerCpu: -1,
			snapshotLagSeconds: 'x',
			enabled: false
		});
		expect(c.heapMb).toBe(50);
		expect(c.loadPerCpu).toBe(DEFAULT_HEALTH_CONFIG.loadPerCpu);
		expect(c.snapshotLagSeconds).toBe(DEFAULT_HEALTH_CONFIG.snapshotLagSeconds);
		expect(c.enabled).toBe(false);
	});
});

describe('HealthMonitor', () => {
	it('reports the process block, with every check ok on a healthy server', async () => {
		const h = harness();
		expect(h.monitor.block()).toBeNull();
		await h.run(0);
		const b = h.monitor.block()!;
		expect(b.memory).toEqual({ rssMb: 300, heapUsedMb: 120, postGcHeapMb: 100, footprintMb: 150 });
		expect(b.eventLoop.p99Ms).toBe(20);
		expect(b.snapshot.lastDurationMs).toBe(2000);
		expect(b.load.cpus).toBe(4);
		expect(b.checks.every((c) => c.state === 'ok')).toBe(true);
		expect(h.rung).toEqual([]);
	});

	it('says the fleet view lags once the snapshot has been slow for the whole window, then settles', async () => {
		const h = harness({ snapshotLagSeconds: 15, snapshotLagMinutes: 10 });
		h.state.snapshot = { lastDurationMs: 22_000, inFlightMs: null };
		await h.run(9 * MIN);
		expect(h.rung).toEqual([]);
		expect(h.check('snapshot-lag').state).toBe('pending');
		await h.run(1 * MIN);
		expect(h.rung).toHaveLength(1);
		expect(h.rung[0].kind).toBe('wheelhouse');
		expect(h.rung[0].text).toContain('The fleet view lags 22 s');
		expect(h.check('snapshot-lag').state).toBe('firing');
		// Rings once per run of it.
		await h.run(5 * MIN);
		expect(h.rung).toHaveLength(1);
		h.state.snapshot = { lastDurationMs: 3_000, inFlightMs: null };
		await h.run(0);
		expect(h.settled).toEqual([h.rung[0].id]);
		expect(h.check('snapshot-lag').state).toBe('ok');
	});

	it('counts a snapshot still running toward the lag', async () => {
		const h = harness({ snapshotLagMinutes: 1 });
		h.state.snapshot = { lastDurationMs: 2_000, inFlightMs: 40_000 };
		await h.run(1 * MIN);
		expect(h.rung[0]?.text).toContain('lags 40 s');
	});

	it('rings and logs the heap and handle counts when the event loop stays slow', async () => {
		const h = harness({ eventLoopP99Ms: 200, eventLoopMinutes: 5 });
		h.state.sample = sample({ eventLoop: { p50Ms: 50, p99Ms: 450, maxMs: 900 } });
		await h.run(4 * MIN);
		expect(h.rung).toEqual([]);
		await h.run(1 * MIN);
		expect(h.rung).toHaveLength(1);
		expect(h.rung[0].text).toContain('450 ms');
		expect(h.logs.join('\n')).toContain('active resources: Timeout=3');
	});

	it('does not ring for a slow loop that recovers inside the window', async () => {
		const h = harness({ eventLoopMinutes: 5 });
		h.state.sample = sample({ eventLoop: { p50Ms: 50, p99Ms: 450, maxMs: 900 } });
		await h.run(3 * MIN);
		h.state.sample = sample();
		await h.run(0);
		h.state.sample = sample({ eventLoop: { p50Ms: 50, p99Ms: 450, maxMs: 900 } });
		await h.run(3 * MIN);
		expect(h.rung).toEqual([]);
	});

	it('restarts only its own server, for a large heap, and only once nothing is in progress', async () => {
		const h = harness({ heapMb: 400 });
		h.state.sample = sample({ postGcHeapMb: 512 });
		h.state.busy = ['1 upload in progress', '1 attached terminal'];
		await h.run(2 * MIN);
		expect(h.restarts).toEqual([]);
		expect(h.rung).toHaveLength(1);
		expect(h.rung[0].text).toContain('512 MB of heap after garbage collection');
		expect(h.check('heap').detail).toContain(
			'restart waits for: 1 upload in progress, 1 attached terminal'
		);
		h.state.busy = [];
		await h.run(0);
		expect(h.restarts).toHaveLength(1);
		expect(h.logs.join('\n')).toContain('Firstmate and its crew are untouched');
		// Asked once: it never asks again in the same process.
		await h.run(2 * MIN);
		expect(h.restarts).toHaveLength(1);
	});

	it('reads post-GC heap, not RSS: a large RSS with a small heap restarts nothing', async () => {
		const h = harness({ heapMb: 400 });
		h.state.sample = sample({ rssMb: 2048, footprintMb: 380, postGcHeapMb: 150 });
		await h.run(5 * MIN);
		expect(h.restarts).toEqual([]);
		expect(h.check('heap').state).toBe('ok');
	});

	it('restarts for heap growth within the window', async () => {
		const h = harness({ heapGrowthMb: 100, heapGrowthHours: 6, heapMb: 4000 });
		h.state.sample = sample({ postGcHeapMb: 150 });
		await h.run(60 * MIN, 10 * MIN);
		h.state.sample = sample({ postGcHeapMb: 260, uptimeSeconds: 7200 + 3600 });
		await h.run(0);
		expect(h.rung[0]?.text).toContain('grew 110 MB within 6 h');
		expect(h.restarts).toHaveLength(1);
	});

	it('never restarts before its minimum uptime, nor without the CLI watcher', async () => {
		const young = harness({ heapMb: 100, restartMinUptimeMinutes: 60 });
		young.state.sample = sample({ postGcHeapMb: 500, uptimeSeconds: 600 });
		await young.run(5 * MIN);
		expect(young.restarts).toEqual([]);

		const bare = harness({ heapMb: 100 });
		bare.state.canRestart = false;
		bare.state.sample = sample({ postGcHeapMb: 500 });
		await bare.run(0);
		expect(bare.rung[0].text).toContain('Restarting Wheelhouse frees the memory');
		expect(bare.check('heap').detail).toContain('restart Wheelhouse by hand');
	});

	it('closes chat followers nobody has listened to for the window, and leaves others alone', async () => {
		const h = harness({ orphanFeedMinutes: 10 });
		const orphan = feed(0, true);
		const listened = feed(2, true);
		const idle = feed(0, false);
		h.state.feeds = [orphan, listened, idle];
		await h.run(9 * MIN);
		expect(orphan.stopped).toBe(0);
		expect(h.monitor.block()!.chatFeeds).toEqual({ count: 3, watching: 2, orphaned: 1 });
		await h.run(1 * MIN);
		expect(orphan.stopped).toBe(1);
		expect(listened.stopped).toBe(0);
		expect(idle.stopped).toBe(0);
		expect(h.logs.join('\n')).toContain('Closed 1 chat follower');
		expect(h.monitor.block()!.chatFeeds.orphaned).toBe(0);
	});

	it('names the heaviest processes, crew tasks first, when the load stays high', async () => {
		const h = harness({ loadPerCpu: 2, loadMinutes: 10 });
		h.state.sample = sample({ load: { avg1: 9.5, avg5: 9, avg15: 7, cpus: 4 } });
		h.state.heavy = [
			{ pid: 10, cpu: 180, command: '/usr/bin/node build.js', taskId: null },
			{ pid: 11, cpu: 95, command: '/home/u/.local/bin/claude --resume', taskId: 'fix-login' }
		];
		await h.run(10 * MIN);
		expect(h.rung).toHaveLength(1);
		expect(h.rung[0].text).toContain('load 9.5 on 4 CPUs for 10 min');
		expect(h.rung[0].text).toContain('Heaviest: claude (fix-login) 95%, node 180%');
	});

	it('marks a remote second mate slow when its reads’ median is over the threshold', async () => {
		const h = harness({ remoteReadP50Seconds: 3 });
		for (const ms of [4100, 3900, 5000]) recordRemoteRead('tokyo', ms, T0);
		for (const ms of [300, 400, 9000]) recordRemoteRead('oslo', ms, T0);
		await h.run(0);
		expect(h.monitor.remoteSlow('tokyo')).toBe('Remote host slow: reads take about 4.1 s');
		expect(h.monitor.remoteSlow('oslo')).toBeNull();
		expect(h.check('remote-slow')).toMatchObject({ state: 'firing', detail: 'tokyo 4.1 s' });
	});

	it('proposes archiving large history to the captain, and never acts on it', async () => {
		const h = harness({ historyCheckHours: 1, dataMb: 100, handledNotes: 50 });
		h.state.history = { dataBytes: 300 * 1024 * 1024, handledNotes: 80, chatArchiveBytes: 0 };
		await h.run(9 * MIN);
		expect(h.rung).toEqual([]);
		await h.run(1 * MIN);
		expect(h.rung).toHaveLength(1);
		expect(h.rung[0].captain).toBe(true);
		expect(h.rung[0].text).toContain("Firstmate's data/ folder is 300 MB (over 100 MB)");
		expect(h.rung[0].text).toContain('80 handled inbox notes (over 50)');
		expect(h.rung[0].text).toContain('never moves or deletes anything');
		expect(h.rung[0].actions).toEqual([]);
		expect(h.restarts).toEqual([]);
		expect(h.monitor.block()!.history).toMatchObject({ dataMb: 300, handledNotes: 80 });
	});

	it('checks nothing when turned off, but still samples', async () => {
		const h = harness({ enabled: false, heapMb: 10, snapshotLagMinutes: 1, snapshotLagSeconds: 1 });
		h.state.snapshot = { lastDurationMs: 60_000, inFlightMs: null };
		h.state.sample = sample({ postGcHeapMb: 900 });
		await h.run(5 * MIN);
		expect(h.rung).toEqual([]);
		expect(h.restarts).toEqual([]);
		expect(h.monitor.block()!.memory.postGcHeapMb).toBe(900);
	});
});
