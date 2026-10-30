import { ACTIVITY_DAYS, dayCounts } from '$lib/berths';
import { runBounded } from './firstmate/exec';

/**
 * How busy a project's clone has been: commits on any branch per day over the last two
 * weeks, oldest first, for the Harbour's project cards. Read with git, bounded, and kept
 * for ten minutes per clone; null when there is no clone or git cannot read it.
 */
const TTL_MS = 10 * 60_000;
const cache = new Map<string, { at: number; value: Promise<number[] | null> }>();

export function commitDays(dir: string | null, now = Date.now()): Promise<number[] | null> {
	if (!dir) return Promise.resolve(null);
	const hit = cache.get(dir);
	if (hit && now - hit.at < TTL_MS) return hit.value;
	const since = new Date(now - (ACTIVITY_DAYS + 1) * 86_400_000).toISOString();
	const value = runBounded('git', ['-C', dir, 'log', '--all', `--since=${since}`, '--format=%ct'], {
		timeoutMs: 5_000,
		maxOutputBytes: 1024 * 1024
	}).then((r) => {
		if (!r.ok) return null;
		const times = r.stdout
			.split('\n')
			.map((s) => Number(s.trim()) * 1000)
			.filter((t) => Number.isFinite(t) && t > 0);
		return dayCounts(times, now, ACTIVITY_DAYS);
	});
	cache.set(dir, { at: now, value });
	return value;
}
