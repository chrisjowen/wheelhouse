import type { MachineSample, ProcessVitals } from '../../soundings';

/** A quiet computer, for tests to change one thing on. */
export function sample(over: Partial<MachineSample> = {}): MachineSample {
	return {
		at: '2026-11-17T12:00:00.000Z',
		platform: 'darwin',
		cpus: 8,
		load: [1.5, 1.4, 1.2],
		memory: {
			totalBytes: 16 * 1024 ** 3,
			availableBytes: 8 * 1024 ** 3,
			pressure: 'normal',
			swapUsedBytes: 0
		},
		disks: [{ mount: '/', sizeBytes: 1000 * 1024 ** 3, availBytes: 400 * 1024 ** 3 }],
		processes: [],
		services: [],
		listeners: [],
		logs: [],
		footprintBytes: null,
		gaps: [],
		tookMs: 800,
		...over
	};
}

/** Wheelhouse in good health. */
export function vitals(over: Partial<ProcessVitals> = {}): ProcessVitals {
	return {
		at: '2026-11-17T12:00:00.000Z',
		pid: 4242,
		uptimeSeconds: 7200,
		rssBytes: 300 * 1024 ** 2,
		heapUsedBytes: 120 * 1024 ** 2,
		postGcHeapBytes: 90 * 1024 ** 2,
		footprintBytes: 250 * 1024 ** 2,
		eventLoopP99Ms: 25,
		streams: 2,
		chatFeeds: { count: 2, listening: 1, watchers: 1, orphans: 0 },
		childrenPerMinute: 12,
		lastSnapshotMs: 1800,
		load: [1.5, 1.4, 1.2],
		...over
	};
}
