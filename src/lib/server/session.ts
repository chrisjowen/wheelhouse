import { randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Protection for mutating requests. Wheelhouse listens on loopback only and
 * refuses foreign Host headers (hooks.server.ts); on top of that, every
 * mutating request must
 *   - carry an Origin header equal to the origin Wheelhouse served the page
 *     from, so another site open in the browser cannot post to it, and
 *   - echo the per-launch session token, which Wheelhouse hands only to the
 *     pages it serves, so a local process or a forged form without the page
 *     cannot either.
 * The token is random per server process and is never written to disk.
 */

export const SESSION_HEADER = 'x-wheelhouse-session';

const KEY = Symbol.for('wheelhouse.session-token');
const g = globalThis as unknown as Record<symbol, string | undefined>;

/** This launch's session token (created on first use, stable across module reloads). */
export function sessionToken(): string {
	g[KEY] ??= randomBytes(32).toString('base64url');
	return g[KEY];
}

function tokenMatches(given: string | null): boolean {
	if (!given) return false;
	const a = Buffer.from(given);
	const b = Buffer.from(sessionToken());
	return a.length === b.length && timingSafeEqual(a, b);
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export const isMutating = (method: string) => !SAFE_METHODS.has(method.toUpperCase());

/** Why a mutating request is refused, or null when it may proceed. */
export function refuseMutation(request: Request, servedOrigin: string): string | null {
	const origin = request.headers.get('origin');
	if (!origin) return 'Requests that change anything must carry an Origin header.';
	if (origin !== servedOrigin) return `Requests from ${origin} are not accepted.`;
	if (!tokenMatches(request.headers.get(SESSION_HEADER))) {
		return 'This request lacks the Wheelhouse session token. Reload the page and try again.';
	}
	return null;
}
