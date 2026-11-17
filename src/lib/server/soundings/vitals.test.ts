import { afterEach, describe, expect, it, vi } from 'vitest';
import { openStreams, resetCounters, streamOpened, type TrackedFeed } from './counters';
import {
	currentVitals,
	minute,
	orphansClosed,
	ORPHAN_AFTER_MS,
	startVitals,
	stopVitals
} from './vitals';

const feed = (listening: number, watching: boolean): TrackedFeed & { stop: () => void } => {
	const f = {
		listening,
		watching,
		stop: vi.fn(() => {
			f.watching = false;
		})
	};
	return f;
};

afterEach(() => {
	stopVitals();
	resetCounters();
});

describe('Wheelhouse’s vitals', () => {
	it('counts open streams, each closed once', () => {
		const close = streamOpened();
		streamOpened();
		expect(openStreams()).toBe(2);
		close();
		close();
		expect(openStreams()).toBe(1);
	});

	it('reports memory, chat followers and the slower of the last and running snapshot', () => {
		startVitals({ snapshot: () => ({ lastDurationMs: 2000, inFlightMs: 31_000 }) });
		const v = currentVitals(Date.now(), () => [feed(1, true), feed(0, true), feed(0, false)]);
		expect(v.pid).toBe(process.pid);
		expect(v.rssBytes).toBeGreaterThan(0);
		expect(v.chatFeeds).toEqual({ count: 3, listening: 1, watchers: 2, orphans: 1 });
		expect(v.lastSnapshotMs).toBe(31_000);
		expect(v.load).toHaveLength(3);
	});

	it('closes a chat follower orphaned for ten minutes, only while Soundings is on', () => {
		let on = false;
		startVitals({ tidy: () => on });
		const orphan = feed(0, true);
		const busy = feed(2, true);
		const feeds = () => [orphan, busy];
		const t = Date.now();
		minute(t, feeds);
		minute(t + ORPHAN_AFTER_MS, feeds);
		expect(orphan.stop).not.toHaveBeenCalled();
		on = true;
		minute(t + ORPHAN_AFTER_MS + 60_000, feeds);
		expect(orphan.stop).toHaveBeenCalledOnce();
		expect(busy.stop).not.toHaveBeenCalled();
		expect(orphansClosed()).toBe(1);
	});

	it('keeps a reading a minute', () => {
		startVitals({ snapshot: () => ({ lastDurationMs: 1200, inFlightMs: null }) });
		const p = minute(1_000_000, () => []);
		expect(p).toEqual({ at: 1_000_000, eventLoopP99Ms: expect.any(Number), lastSnapshotMs: 1200 });
	});
});
