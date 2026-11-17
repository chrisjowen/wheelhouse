/**
 * Counts the health check reads that live in many places: the open
 * server-sent event streams, uploads being saved, every chat follower
 * (ChatFeed) and how long remote second mates' reads take. Kept on
 * globalThis, like the runtime, so Vite's module reloading in development
 * does not start a second count.
 */

/** What the health check needs of a chat follower (sessions/transcript.ts's ChatFeed). */
export interface TrackedFeed {
	/** Pages listening now. */
	readonly listening: number;
	/** It holds a file watcher. */
	readonly watching: boolean;
	/** Stop polling and close its watcher (it starts again when a page listens). */
	stop(): void;
}

interface RemoteSample {
	at: number;
	ms: number;
}

interface Counters {
	sse: number;
	uploads: number;
	feeds: Set<WeakRef<TrackedFeed>>;
	remote: Map<string, RemoteSample[]>;
}

const KEY = Symbol.for('wheelhouse.health.counters');
const g = globalThis as unknown as Record<symbol, Counters | undefined>;

function counters(): Counters {
	return (g[KEY] ??= { sse: 0, uploads: 0, feeds: new Set(), remote: new Map() });
}

/** Count something open until the returned function is called (once; later calls do nothing). */
function opened(key: 'sse' | 'uploads'): () => void {
	const c = counters();
	c[key]++;
	let open = true;
	return () => {
		if (!open) return;
		open = false;
		c[key] = Math.max(0, c[key] - 1);
	};
}

/** A server-sent event stream opened; call the result when it closes. */
export const sseOpened = (): (() => void) => opened('sse');
export const openStreams = (): number => counters().sse;

/** An upload started saving; call the result when it is saved or refused. */
export const uploadStarted = (): (() => void) => opened('uploads');
export const uploadsInProgress = (): number => counters().uploads;

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

/** How many recent reads per second mate the median is taken over. */
const REMOTE_SAMPLES = 10;
/** Reads older than this no longer count. */
const REMOTE_WINDOW_MS = 30 * 60_000;

/** A read of a remote second mate (through fm-on.sh) took `ms`. */
export function recordRemoteRead(mateId: string, ms: number, now = Date.now()): void {
	const map = counters().remote;
	const list = (map.get(mateId) ?? []).filter((s) => now - s.at < REMOTE_WINDOW_MS);
	list.push({ at: now, ms });
	map.set(mateId, list.slice(-REMOTE_SAMPLES));
}

/** The median of a remote second mate's recent reads, in ms; null with fewer than three. */
export function remoteReadP50(mateId: string, now = Date.now()): number | null {
	const list = (counters().remote.get(mateId) ?? []).filter((s) => now - s.at < REMOTE_WINDOW_MS);
	if (list.length < 3) return null;
	return median(list.map((s) => s.ms));
}

/** Every remote second mate with recent reads, and their median. */
export function remoteReads(now = Date.now()): { mate: string; p50Ms: number; reads: number }[] {
	const out: { mate: string; p50Ms: number; reads: number }[] = [];
	for (const [mate, all] of counters().remote) {
		const list = all.filter((s) => now - s.at < REMOTE_WINDOW_MS);
		if (list.length) out.push({ mate, p50Ms: median(list.map((s) => s.ms)), reads: list.length });
	}
	return out;
}

export function median(xs: number[]): number {
	const s = [...xs].sort((a, b) => a - b);
	const mid = s.length >> 1;
	return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

/** For tests: forget everything counted. */
export function resetCounters(): void {
	g[KEY] = undefined;
}
