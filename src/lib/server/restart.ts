/**
 * Restarting this Wheelhouse from inside it, after an upgrade or a plugin
 * change made from a page. `wheelhouse open` runs the server under a watcher
 * (cli/supervise.ts) and leaves a function here that closes the server with
 * RESTART_EXIT, which the watcher answers by starting it again on the same
 * port. A server started any other way (`vite dev`) has none, and says so.
 */

const KEY = Symbol.for('wheelhouse.restart');
const g = globalThis as unknown as Record<symbol, (() => void) | undefined>;

/** Left by the CLI's server: close it so its watcher starts it again. */
export function setRestart(fn: (() => void) | null): void {
	g[KEY] = fn ?? undefined;
}

/** This server can restart itself (it runs under `wheelhouse open`). */
export const canRestart = (): boolean => typeof g[KEY] === 'function';

/** Restart shortly, once the answer that asked for it has gone out. */
export function restartSoon(ms = 300): boolean {
	const fn = g[KEY];
	if (!fn) return false;
	setTimeout(fn, ms);
	return true;
}
