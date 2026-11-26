import { randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Protection for mutating requests. Wheelhouse listens on loopback (unless
 * WHEELHOUSE_HOST says otherwise) and refuses Host headers that are neither
 * loopback nor allowed (hooks.server.ts); on top of that, every
 * mutating request must
 *   - carry an Origin header equal to the origin Wheelhouse served the page
 *     from, so another site open in the browser cannot post to it, and
 *   - echo the per-launch session token, which Wheelhouse hands only to the
 *     pages it serves, so a local process or a forged form without the page
 *     cannot either.
 * The token is random per server process and is never written to disk.
 */

export const SESSION_HEADER = 'x-wheelhouse-session';

/** The Host values Wheelhouse always answers; any other is refused unless allowed (below). */
export const LOOPBACK_HOST = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i;

/**
 * Extra Host values to answer besides loopback, for a cloud IDE (Ona,
 * Codespaces) whose port forward passes its own URL as the Host: a comma list
 * of host names, each exact (`4310--abc.example.dev`) or a true suffix
 * (`*.example.dev`, which matches `x.example.dev` and `a.b.example.dev`, never
 * `example.dev` or `evilexample.dev`). Empty by default: loopback only.
 */
export const ALLOWED_HOSTS_ENV = 'WHEELHOUSE_ALLOWED_HOSTS';

const NAME = /^[a-z0-9-]+(?:\.[a-z0-9-]+)*$/;
/** A suffix names at least two labels, so `*.dev` cannot open every host under a top-level domain. */
const SUFFIX = /^\*\.([a-z0-9-]+(?:\.[a-z0-9-]+)+)$/;

export interface AllowedHosts {
	exact: Set<string>;
	/** Each with its leading dot, such as `.example.dev`. */
	suffixes: string[];
	/** Entries that are neither, as given. */
	invalid: string[];
}

/** The allowed hosts a list such as `*.example.dev,ide.example.com` names. */
export function parseAllowedHosts(raw: string | undefined): AllowedHosts {
	const out: AllowedHosts = { exact: new Set(), suffixes: [], invalid: [] };
	for (const entry of (raw ?? '').split(',')) {
		const e = entry.trim().toLowerCase();
		if (!e) continue;
		const suffix = SUFFIX.exec(e);
		if (suffix) out.suffixes.push(`.${suffix[1]}`);
		else if (NAME.test(e) && !e.startsWith('-')) out.exact.add(e);
		else out.invalid.push(entry.trim());
	}
	return out;
}

let parsed: { raw: string | undefined; hosts: AllowedHosts } | null = null;

/** The allowed hosts the environment names (read each time, parsed once per value). */
export function allowedHosts(env: Record<string, string | undefined> = process.env): AllowedHosts {
	const raw = env[ALLOWED_HOSTS_ENV];
	if (!parsed || parsed.raw !== raw) parsed = { raw, hosts: parseAllowedHosts(raw) };
	return parsed.hosts;
}

/** Whether `host` (a Host header, perhaps with a port) is one of the allowed non-loopback hosts. */
export function isAllowedHost(
	host: string,
	env: Record<string, string | undefined> = process.env
): boolean {
	const allowed = allowedHosts(env);
	if (!allowed.exact.size && !allowed.suffixes.length) return false;
	const m = /^([a-z0-9.-]+)(?::\d{1,5})?$/i.exec(host);
	const name = m?.[1].toLowerCase() ?? '';
	if (!NAME.test(name)) return false;
	return allowed.exact.has(name) || allowed.suffixes.some((s) => name.endsWith(s));
}

/** Whether Wheelhouse answers a request with this Host: loopback, or an allowed host. */
export const acceptedHost = (
	host: string,
	env: Record<string, string | undefined> = process.env
): boolean => LOOPBACK_HOST.test(host) || isAllowedHost(host, env);

/**
 * The origin a page was served from, for a request with this Host and
 * X-Forwarded-Proto. Wheelhouse serves plain HTTP on loopback, so there it is
 * http://<Host>; through an allowed host (a cloud IDE's HTTPS forward) it is
 * https://<Host>, or http:// when the forward says so in X-Forwarded-Proto.
 */
export function originFor(
	host: string,
	forwardedProto: string | string[] | null | undefined,
	env: Record<string, string | undefined> = process.env
): string {
	const h = host.toLowerCase();
	if (LOOPBACK_HOST.test(h) || !isAllowedHost(h, env)) return `http://${h}`;
	const first = (Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto)
		?.split(',')[0]
		?.trim()
		.toLowerCase();
	return `${first === 'http' ? 'http' : 'https'}://${h}`;
}

/**
 * The origin a request's page was served from (originFor). event.url.origin
 * is not used because adapter-node assumes https without ORIGIN set.
 */
export function servedOrigin(request: Request): string {
	return originFor(request.headers.get('host') ?? '', request.headers.get('x-forwarded-proto'));
}

const KEY = Symbol.for('wheelhouse.session-token');
const g = globalThis as unknown as Record<symbol, string | undefined>;

/** This launch's session token (created on first use, stable across module reloads). */
export function sessionToken(): string {
	g[KEY] ??= randomBytes(32).toString('base64url');
	return g[KEY];
}

const INSTANCE = Symbol.for('wheelhouse.server-instance');

/**
 * Names this server process to the pages on its live stream, so a page that
 * reconnects can tell the server restarted. Public, unlike the session token.
 */
export function serverInstance(): string {
	g[INSTANCE] ??= randomBytes(8).toString('hex');
	return g[INSTANCE];
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
	return refuseCaller(
		request.headers.get('origin'),
		request.headers.get(SESSION_HEADER),
		servedOrigin
	);
}

/**
 * The same check for any caller: the Origin it sent and the token it echoed.
 * The live session terminal (a WebSocket, which cannot carry custom headers)
 * passes the token as a subprotocol instead of SESSION_HEADER.
 */
export function refuseCaller(
	origin: string | null | undefined,
	token: string | null | undefined,
	servedOrigin: string
): string | null {
	if (!origin) return 'Requests that change anything must carry an Origin header.';
	if (origin !== servedOrigin) return `Requests from ${origin} are not accepted.`;
	if (!tokenMatches(token ?? null)) {
		return 'This request lacks the Wheelhouse session token. Reload the page and try again.';
	}
	return null;
}
