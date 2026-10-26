import { runBounded } from './firstmate/exec';
import { webUrl } from '../repo';

/**
 * A project clone's repository in the browser, from its `origin` remote
 * (GitHub-style remotes only; see webUrl). Read with git, bounded, and kept
 * for a minute per clone.
 */
const cache = new Map<string, { at: number; value: Promise<string | null> }>();
const TTL_MS = 60_000;

export function repoUrl(dir: string | null, now = Date.now()): Promise<string | null> {
	if (!dir) return Promise.resolve(null);
	const hit = cache.get(dir);
	if (hit && now - hit.at < TTL_MS) return hit.value;
	const value = runBounded('git', ['-C', dir, 'remote', 'get-url', 'origin'], {
		timeoutMs: 2_000,
		maxOutputBytes: 4096
	}).then((r) => (r.ok ? webUrl(r.stdout) : null));
	cache.set(dir, { at: now, value });
	return value;
}
