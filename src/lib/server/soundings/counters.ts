/**
 * Counts Soundings' vitals read from many places: the open server-sent event
 * streams, and every chat follower (ChatFeed). Kept on globalThis, like the
 * runtime, so Vite's module reloading in development does not start a second
 * count.
 */

/** What Soundings needs of a chat follower (sessions/transcript.ts's ChatFeed). */
export interface TrackedFeed {
	/** Pages listening now. */
	readonly listening: number;
	/** It holds a file watcher or a poll timer. */
	readonly watching: boolean;
	/** Stop polling and close its watcher (it starts again when a page listens). */
	stop(): void;
}

interface Counters {
	streams: number;
	feeds: Set<WeakRef<TrackedFeed>>;
}

const KEY = Symbol.for('wheelhouse.soundings.counters');
const g = globalThis as unknown as Record<symbol, Counters | undefined>;

function counters(): Counters {
	return (g[KEY] ??= { streams: 0, feeds: new Set() });
}

/** A server-sent event stream opened; call the result when it closes (later calls do nothing). */
export function streamOpened(): () => void {
	const c = counters();
	c.streams++;
	let open = true;
	return () => {
		if (!open) return;
		open = false;
		c.streams = Math.max(0, c.streams - 1);
	};
}

export const openStreams = (): number => counters().streams;

/** Track a chat follower for as long as it lives (held weakly: tracking never keeps one alive). */
export function trackFeed(feed: TrackedFeed): void {
	counters().feeds.add(new WeakRef(feed));
}

/** The chat followers still alive (dropping those already collected). */
export function trackedFeeds(): TrackedFeed[] {
	const out: TrackedFeed[] = [];
	const set = counters().feeds;
	for (const ref of set) {
		const f = ref.deref();
		if (f) out.push(f);
		else set.delete(ref);
	}
	return out;
}

/** For tests: forget everything counted. */
export function resetCounters(): void {
	g[KEY] = undefined;
}
