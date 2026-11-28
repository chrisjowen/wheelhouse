import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { KeyObject } from 'node:crypto';
import http from 'node:http';
import http2 from 'node:http2';
import type { Duplex } from 'node:stream';
import { CHALLENGE_TTL_MS, VERIFIED_IDLE_MS, VERIFIED_SESSION_MS } from './guard';
import { assertionProblem, newChallenge, type PinnedPasskey } from './passkeys';
import { HOP_BY_HOP, isRestartPath, machineHost } from './protocol';
import { relativeLocation, type RelayContext, type RelayTargets } from './relay';

/**
 * This machine's own origin server (§12.4–§12.6 of the protocol). It
 * terminates the browser's TLS for each `tls` stream inside the connector,
 * with the key only this machine holds, and serves HTTP/2 (or HTTP/1.1 to a
 * browser that won't, and for WebSockets). It signs the captain in with a
 * passkey this machine pinned, signed on its own origin, and only then
 * proxies to the local Wheelhouse and its previews under §6.3's rules. The
 * gateway carries the TLS records and sees none of this.
 *
 * Paths under `/__whm/` are the connector's own and never reach Wheelhouse.
 * Before sign-in nothing of Wheelhouse is reachable: a page asked for gets
 * 401 with a short note, and anything else 401 JSON.
 */

export const SESSION_COOKIE = '__Host-whm_session';
export const PRE_COOKIE = '__Host-whm_pre';
/** A preview grant is good for one host, one use and this long (§12.10). */
export const GRANT_MS = 60_000;
/** Sign-in challenges (§12.10): this many per client IP in this window, and at most this many waiting. */
export const CHALLENGES_PER_IP = 30;
const CHALLENGE_WINDOW_MS = 10 * 60_000;
export const MAX_WAITING = 16;
const MAX_SESSIONS = 64;
/** A cookie in use gets a new token once its own is this old (design.md, "Sessions"). */
export const ROTATE_MS = 60 * 60_000;
/** The token it replaced keeps working this long past the new one's first use. */
const ROTATED_GRACE_MS = 60_000;
const HANDSHAKE_MS = 10_000;
const MAX_JSON = 64 * 1024;
const MAX_PATH = 8192;
const NO_CHALLENGE = 'no live sign-in challenge: never issued, already used, or expired';
/** TLS 1.3's suites, then TLS 1.2's forward-secret AEAD suites for this machine's ECDSA key (§12.4). */
const CIPHERS = [
	'TLS_AES_128_GCM_SHA256',
	'TLS_AES_256_GCM_SHA384',
	'TLS_CHACHA20_POLY1305_SHA256',
	'ECDHE-ECDSA-AES128-GCM-SHA256',
	'ECDHE-ECDSA-AES256-GCM-SHA384',
	'ECDHE-ECDSA-CHACHA20-POLY1305'
].join(':');

export interface OriginServerOptions {
	/** The local Wheelhouse, its previews, and whether the cloud is still on here. */
	targets: RelayTargets;
	/** The passkeys this machine trusts now; a session signed by one it no longer trusts ends. */
	pins: () => PinnedPasskey[];
	/** GATEWAY's origin: its host is the passkeys' RP ID (§12.5), and it may frame the app (§12.6). */
	gateway: string;
	/** A request or WebSocket was served for this machine session, as relayed ones are reported. */
	onRelayed?: (relay: RelayContext) => void;
	log?: (line: string) => void;
	now?: () => number;
}

/** What this machine serves a `tls` stream with: its names (§12.1) and its key and chain (§12.2). */
export interface OriginServing {
	label: string;
	domain: string;
	key: KeyObject;
	chain: string;
}

interface Session {
	id: string;
	/** The credential id of the passkey that signed it in. */
	credential: string;
	/** That passkey's name. */
	passkey: string;
	signedAt: number;
	usedAt: number;
	ended: boolean;
	entries: Set<Entry>;
}

/** One host's cookie for a session: the app host's, or a preview host's (§12.6). Only token hashes are kept. */
interface Entry {
	session: Session;
	host: string;
	current: string;
	issuedAt: number;
	/** The token `current` replaced, good until `current` is first used and a minute more. */
	prior?: string;
	priorUntil?: number;
}

interface Connection {
	label: string;
	domain: string;
	ip: string | null;
}

/** The host a request came in on: one of this machine's names. */
interface Site {
	host: string;
	/** 0 on the app host, else the preview port. */
	port: number;
	/** `:<port>` when the browser reached the gateway on a port other than 443 (a test or dev gateway), else empty. */
	suffix: string;
	/** This host's own origin. */
	own: string;
	/** The app origin. */
	app: string;
}

type Request = http2.Http2ServerRequest | http.IncomingMessage;
type Response = http2.Http2ServerResponse;

const hash = (token: string) => createHash('sha256').update(token).digest('hex');
const newToken = () => randomBytes(32).toString('base64url');

function cookies(header: string | string[] | undefined): Map<string, string> {
	const out = new Map<string, string>();
	for (const part of (Array.isArray(header) ? header.join('; ') : (header ?? '')).split(';')) {
		const i = part.indexOf('=');
		if (i < 0) continue;
		const name = part.slice(0, i).trim();
		if (name && !out.has(name)) out.set(name, part.slice(i + 1).trim());
	}
	return out;
}

/** The `cookie` header without this machine's own `__Host-whm_*` cookies (§12.4). */
function withoutOwnCookies(header: string | string[]): string {
	return (Array.isArray(header) ? header.join('; ') : header)
		.split(';')
		.map((c) => c.trim())
		.filter((c) => c && !c.split('=', 1)[0].trim().startsWith('__Host-whm_'))
		.join('; ');
}

const ownCookie = (setCookie: string) =>
	setCookie.split('=', 1)[0].trim().startsWith('__Host-whm_');

function setCookie(name: string, value: string, sameSite: 'Lax' | 'Strict', maxAgeMs: number) {
	const maxAge = Math.max(0, Math.ceil(maxAgeMs / 1000));
	return `${name}=${value}; Path=/; Secure; HttpOnly; SameSite=${sameSite}; Max-Age=${maxAge}`;
}

/** A GET the browser makes to show a page, rather than a fetch or a subresource. */
function isNavigation(req: Request): boolean {
	if (req.method !== 'GET') return false;
	const mode = req.headers['sec-fetch-mode'];
	return mode ? mode === 'navigate' : String(req.headers.accept ?? '').includes('text/html');
}

/**
 * §12.6: whether a request passes the CSRF check, and whether it did so with
 * an `Origin` (so the local server may see one). GATEWAY's pages are the same
 * site, so SameSite cookies don't help.
 */
function csrf(req: Request, own: string): { originChecked: boolean } | null {
	const origin = req.headers.origin;
	if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method ?? '')) {
		const passes =
			origin !== undefined ? origin === own : req.headers['sec-fetch-site'] === 'same-origin';
		if (!passes) return null;
	}
	return { originChecked: origin === own };
}

function decodedPath(path: string): string {
	const bare = path.split('?', 1)[0];
	try {
		return decodeURIComponent(bare);
	} catch {
		return bare;
	}
}

/** A request path this server takes: absolute, not too long, no control characters. */
function goodPath(path: unknown): path is string {
	return (
		typeof path === 'string' &&
		path.startsWith('/') &&
		path.length <= MAX_PATH &&
		// eslint-disable-next-line no-control-regex -- control characters are exactly what is refused
		!/[\x00-\x1f\x7f]/.test(path)
	);
}

/** A path to send the browser on to, on the same host: `/` for anything else (design.md, "Safe paths"). */
export function safeNext(next: unknown): string {
	return goodPath(next) && !/^\/[/\\]/.test(next) && !next.includes('\\') ? next : '/';
}

/** Header pairs from Node's raw headers, names lowercased. */
function headerPairs(raw: string[]): [string, string][] {
	const out: [string, string][] = [];
	for (let i = 0; i + 1 < raw.length; i += 2) out.push([raw[i].toLowerCase(), raw[i + 1]]);
	return out;
}

export class OriginServer {
	private readonly now: () => number;
	private readonly gatewayHost: string;
	private readonly gatewayOrigin: string;
	/** Session ticket keys shared by every connection, so a browser can resume TLS. */
	private readonly ticketKeys = randomBytes(48);
	/** Preview grants are signed with a key this machine makes and never sends anywhere (§12.6). */
	private readonly grantKey = randomBytes(32);
	private readonly usedNonces = new Map<string, number>();
	private readonly sessions = new Map<string, Session>();
	private readonly tokens = new Map<string, Entry>();
	/** Sign-in challenges waiting for a signature, by the hash of their `__Host-whm_pre` token. */
	private readonly challenges = new Map<string, { challenge: string; expires: number }>();
	/** When each client IP last asked for a challenge, within the window. */
	private readonly asked = new Map<string, number[]>();
	private readonly live = new Set<Duplex>();
	private tls: { chain: string; key: string } | null = null;

	constructor(private readonly o: OriginServerOptions) {
		this.now = o.now ?? Date.now;
		this.gatewayHost = new URL(o.gateway).hostname;
		this.gatewayOrigin = new URL(o.gateway).origin;
	}

	/** Ends every machine session and closes every connection: the connector stopped. */
	close(): void {
		for (const s of [...this.sessions.values()]) this.drop(s);
		this.challenges.clear();
		for (const stream of [...this.live]) stream.destroy();
		this.live.clear();
	}

	/**
	 * Terminates the browser's TLS on one `tls` stream (§12.4) and serves
	 * HTTP/2, or HTTP/1.1, over it. `ip` is the gateway's word for the
	 * browser's address: only for this machine's own limits, never
	 * authentication.
	 */
	serve(stream: Duplex, info: { ip: string | null }, serving: OriginServing): void {
		const conn: Connection = { label: serving.label, domain: serving.domain, ip: info.ip };
		const server = http2.createSecureServer(
			{
				key: this.keyPem(serving),
				cert: serving.chain,
				allowHTTP1: true,
				minVersion: 'TLSv1.2',
				ciphers: CIPHERS,
				honorCipherOrder: true,
				ticketKeys: this.ticketKeys,
				handshakeTimeout: HANDSHAKE_MS
			},
			(req, res) => {
				this.request(req, res, conn).catch((e: unknown) => {
					this.log(`an origin request failed: ${(e as Error).message}`);
					if (!res.headersSent) this.json(res, 500, { error: 'internal error' });
					else res.destroy();
				});
			}
		);
		server.on('upgrade', (req: http.IncomingMessage, socket: Duplex, head: Buffer) => {
			this.upgrade(req, socket, head, conn).catch(() => socket.destroy());
		});
		server.on('tlsClientError', () => stream.destroy());
		stream.on('error', () => {});
		this.live.add(stream);
		stream.once('close', () => this.live.delete(stream));
		server.emit('connection', stream);
	}

	private keyPem(serving: OriginServing): string {
		if (this.tls?.chain !== serving.chain) {
			const key = serving.key.export({ format: 'pem', type: 'pkcs8' }) as string;
			this.tls = { chain: serving.chain, key };
		}
		return this.tls.key;
	}

	// ---- requests ----

	/** The machine name a request came in on, from `:authority` or `Host` (HTTP/2 may reuse one connection for several). */
	private site(req: Request, c: Connection): Site | null {
		const raw = req.headers[':authority'] ?? req.headers.host;
		const m =
			typeof raw === 'string' ? /^([^:]+?)\.?(?::([1-9]\d{0,4}))?$/.exec(raw.toLowerCase()) : null;
		if (!m) return null;
		const host = m[1];
		const name = machineHost(host, c.domain);
		if (!name || name.label !== c.label) return null;
		const suffix = m[2] && m[2] !== '443' ? `:${m[2]}` : '';
		return {
			host,
			port: name.port,
			suffix,
			own: `https://${host}${suffix}`,
			app: `https://${c.label}.${c.domain}${suffix}`
		};
	}

	private async request(req: Request, res: Response, c: Connection) {
		const site = this.site(req, c);
		if (!site) return this.text(res, 421, 'This connection does not serve that name.');
		const path = req.url;
		if (!goodPath(path)) return this.text(res, 400, 'Bad request');
		const checked = csrf(req, site.own);
		if (!checked) return this.json(res, 403, { error: 'refused a cross-origin request' });
		const decoded = decodedPath(path);
		if (decoded.toLowerCase().startsWith('/__whm/')) return this.own(req, res, site, c, decoded);
		const valid = this.validate(req.headers.cookie, site.host);
		if (!valid) {
			if (!isNavigation(req))
				return this.json(res, 401, { error: 'sign in to this machine first' });
			if (!site.port) return this.signinFirst(res);
			const next = encodeURIComponent(safeNext(path));
			return this.redirect(res, `${site.app}/__whm/preview?port=${site.port}&next=${next}`);
		}
		const refused = await this.refusal(site.port, decoded);
		if (refused) {
			this.log(`refused ${refused}`);
			return this.json(res, 403, { error: refused });
		}
		this.proxy(req, res, site, valid, checked.originChecked);
	}

	/** §6.4, as it applies here: the cloud turned off, a port that isn't a current preview, the Wheelhouse port, and restart. */
	private async refusal(port: number, path: string): Promise<string | null> {
		if (!this.o.targets.enabled()) return 'Wheelhouse Cloud is turned off on this machine.';
		if (isRestartPath(path)) return 'Wheelhouse cannot be restarted through the cloud.';
		if (port) {
			const previews = await this.o.targets.previewPorts();
			if (port === this.o.targets.appPort() || !previews.has(port)) {
				return `port ${port} is not a Wheelhouse preview.`;
			}
		}
		return null;
	}

	/** Paths under `/__whm/` belong to the connector and never reach the local server (§12.4). */
	private async own(req: Request, res: Response, site: Site, c: Connection, path: string) {
		const app = site.port === 0;
		const only = (want: string, fn: () => unknown) =>
			req.method === want ? fn() : this.json(res, 405, { error: 'method not allowed' });
		if (app && path === '/__whm/challenge') return only('POST', () => this.challenge(req, res, c));
		if (app && path === '/__whm/signin') return only('POST', () => this.signin(req, res, site));
		if (app && path === '/__whm/preview') return only('GET', () => this.preview(req, res, site));
		if (!app && path === '/__whm/enter') return only('GET', () => this.enter(req, res, site));
		return this.json(res, 404, { error: 'not found' });
	}

	/** §12.5 step 2: a fresh challenge, bound to a `__Host-whm_pre` cookie, for the passkeys it pins. */
	private async challenge(req: Request, res: Response, c: Connection) {
		await readJson(req);
		const pins = this.o.pins();
		if (!pins.length) return this.json(res, 503, { error: 'this machine has no pinned passkeys' });
		const now = this.now();
		for (const [k, ch] of this.challenges) if (ch.expires < now) this.challenges.delete(k);
		for (const [k, times] of this.asked) {
			if (!times.some((t) => now - t < CHALLENGE_WINDOW_MS)) this.asked.delete(k);
		}
		const ip = c.ip ?? '';
		const recent = (this.asked.get(ip) ?? []).filter((t) => now - t < CHALLENGE_WINDOW_MS);
		if (recent.length >= CHALLENGES_PER_IP || this.challenges.size >= MAX_WAITING) {
			return this.json(res, 429, { error: 'too many sign-ins; try again later' });
		}
		this.asked.set(ip, [...recent, now]);
		const token = newToken();
		const challenge = newChallenge('originSession');
		this.challenges.set(hash(token), { challenge, expires: now + CHALLENGE_TTL_MS });
		res.setHeader('set-cookie', setCookie(PRE_COOKIE, token, 'Strict', CHALLENGE_TTL_MS));
		return this.json(res, 200, {
			challenge,
			credentials: pins.map((p) => p.id),
			rpId: this.gatewayHost
		});
	}

	/**
	 * §12.5 steps 4–6: the assertion must sign the challenge bound to this
	 * browser's `__Host-whm_pre`, with a passkey this machine trusts now, on
	 * exactly this machine's app origin.
	 */
	private async signin(req: Request, res: Response, site: Site) {
		const body = await readJson(req);
		const token = cookies(req.headers.cookie).get(PRE_COOKIE);
		const issued = token ? this.challenges.get(hash(token)) : undefined;
		if (token) this.challenges.delete(hash(token));
		const clearPre = setCookie(PRE_COOKIE, '', 'Strict', 0);
		res.setHeader('set-cookie', clearPre);
		const pins = this.o.pins();
		const assertion =
			body && typeof body === 'object' ? (body as Record<string, unknown>).assertion : undefined;
		const problem =
			!issued || issued.expires < this.now()
				? NO_CHALLENGE
				: assertionProblem(assertion, {
						purpose: 'originSession',
						challenge: issued.challenge,
						origin: site.app,
						rpId: this.gatewayHost,
						passkeys: pins
					});
		if (problem) {
			this.log(`refused a sign-in on its own origin: ${problem}`);
			return this.json(res, 403, { error: problem });
		}
		const passkey = pins.find((p) => p.id === (assertion as { id: string }).id)!;
		const now = this.now();
		const session: Session = {
			id: randomUUID(),
			credential: passkey.id,
			passkey: passkey.name,
			signedAt: now,
			usedAt: now,
			ended: false,
			entries: new Set()
		};
		this.sessions.set(session.id, session);
		while (this.sessions.size > MAX_SESSIONS) this.drop(this.sessions.values().next().value!);
		const fresh = this.enterHost(session, site.host);
		res.setHeader('set-cookie', [clearPre, this.sessionCookie(session, fresh)]);
		this.log(
			`${passkey.name || passkey.id.slice(0, 8)} signed in on this machine’s own origin (session ${session.id.slice(0, 8)}).`
		);
		return this.json(res, 200, { ok: true });
	}

	/** §12.6 step 2: the app host mints a grant for one of its preview hosts. */
	private async preview(req: Request, res: Response, site: Site) {
		const url = new URL(req.url ?? '/', site.own);
		const raw = url.searchParams.get('port') ?? '';
		const port = /^[1-9]\d{0,4}$/.test(raw) ? Number(raw) : NaN;
		const next = url.searchParams.get('next') ?? '/';
		if (!(port >= 1 && port <= 65535) || safeNext(next) !== next) {
			return this.text(res, 400, 'Bad preview link');
		}
		const valid = this.validate(req.headers.cookie, site.host);
		if (!valid) {
			return isNavigation(req)
				? this.signinFirst(res)
				: this.json(res, 403, { error: 'sign in to this machine first' });
		}
		const refused = await this.refusal(port, next);
		if (refused) return this.json(res, 403, { error: refused });
		const host = `p${port}.${site.host}`;
		const grant = this.mintGrant(valid.entry.session, host, next);
		const to = `https://${host}${site.suffix}/__whm/enter?grant=${grant}&next=${encodeURIComponent(next)}`;
		return this.redirect(res, to, valid.cookie);
	}

	/** §12.6 step 3: a preview host checks the grant, then sets its own session cookie. */
	private enter(req: Request, res: Response, site: Site) {
		const url = new URL(req.url ?? '/', site.own);
		const next = url.searchParams.get('next');
		const session = this.takeGrant(url.searchParams.get('grant') ?? '', site.host, next);
		if (!session) {
			return this.text(
				res,
				403,
				'This preview link is not valid. Open the preview again from Wheelhouse.'
			);
		}
		const fresh = this.enterHost(session, site.host);
		return this.redirect(res, safeNext(next), this.sessionCookie(session, fresh));
	}

	// ---- sessions ----

	private inForce(s: Session): boolean {
		const now = this.now();
		return (
			!s.ended &&
			now - s.signedAt <= VERIFIED_SESSION_MS &&
			now - s.usedAt <= VERIFIED_IDLE_MS &&
			this.o.pins().some((p) => p.id === s.credential)
		);
	}

	private drop(s: Session) {
		s.ended = true;
		this.sessions.delete(s.id);
		for (const e of s.entries) {
			this.tokens.delete(e.current);
			if (e.prior) this.tokens.delete(e.prior);
		}
		s.entries.clear();
	}

	/** A new cookie for `session` on `host`, replacing any entry it already has there; returns its token. */
	private enterHost(session: Session, host: string): string {
		for (const e of session.entries) {
			if (e.host !== host) continue;
			session.entries.delete(e);
			this.tokens.delete(e.current);
			if (e.prior) this.tokens.delete(e.prior);
		}
		const token = newToken();
		const entry: Entry = { session, host, current: hash(token), issuedAt: this.now() };
		session.entries.add(entry);
		this.tokens.set(entry.current, entry);
		return token;
	}

	private sessionCookie(s: Session, token: string): string {
		return setCookie(SESSION_COOKIE, token, 'Lax', s.signedAt + VERIFIED_SESSION_MS - this.now());
	}

	/**
	 * The session a request's `__Host-whm_session` names on `host`, while it is
	 * in force: signed in less than 30 days ago, used in the last 12 hours, by
	 * a passkey still pinned. It counts as use, and then a token an hour old is
	 * rotated (`cookie` is the new Set-Cookie).
	 */
	private validate(
		header: string | string[] | undefined,
		host: string
	): { entry: Entry; cookie?: string } | null {
		const token = cookies(header).get(SESSION_COOKIE);
		if (!token) return null;
		const h = hash(token);
		const entry = this.tokens.get(h);
		if (!entry || entry.host !== host) return null;
		const s = entry.session;
		if (!this.inForce(s)) {
			this.drop(s);
			return null;
		}
		const now = this.now();
		if (h === entry.prior && entry.priorUntil !== undefined && now > entry.priorUntil) return null;
		s.usedAt = now;
		if (h === entry.current) {
			if (entry.prior && entry.priorUntil === undefined) entry.priorUntil = now + ROTATED_GRACE_MS;
			if (now - entry.issuedAt < ROTATE_MS) return { entry };
			if (entry.prior) this.tokens.delete(entry.prior);
			entry.prior = entry.current;
			entry.priorUntil = undefined;
		} else {
			// On the token it replaced: the new one hasn't come back yet. Once it has had a minute to,
			// it never reached the browser, so the next rotation replaces it.
			if (entry.priorUntil !== undefined || now - entry.issuedAt < ROTATED_GRACE_MS) {
				return { entry };
			}
			this.tokens.delete(entry.current);
		}
		const fresh = newToken();
		entry.current = hash(fresh);
		entry.issuedAt = now;
		this.tokens.set(entry.current, entry);
		return { entry, cookie: this.sessionCookie(s, fresh) };
	}

	private mac(payload: string): string {
		return createHmac('sha256', this.grantKey).update(payload).digest('base64url');
	}

	private mintGrant(s: Session, host: string, next: string): string {
		const grant = {
			s: s.id,
			h: host,
			n: next,
			e: this.now() + GRANT_MS,
			r: randomBytes(16).toString('base64url')
		};
		const payload = Buffer.from(JSON.stringify(grant)).toString('base64url');
		return `${payload}.${this.mac(payload)}`;
	}

	/** A grant's session, once its signature, host, `next` and expiry check out and its nonce is spent. */
	private takeGrant(token: string, host: string, next: string | null): Session | null {
		const now = this.now();
		for (const [n, until] of this.usedNonces) if (until < now) this.usedNonces.delete(n);
		const [payload, mac] = token.split('.');
		if (!payload || !mac) return null;
		const want = Buffer.from(this.mac(payload));
		const got = Buffer.from(mac);
		if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
		let g: Record<string, unknown>;
		try {
			g = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
		} catch {
			return null;
		}
		if (g.h !== host || g.n !== next || safeNext(next) !== next) return null;
		if (typeof g.e !== 'number' || g.e < now || typeof g.r !== 'string') return null;
		if (this.usedNonces.has(g.r)) return null;
		this.usedNonces.set(g.r, g.e);
		const s = typeof g.s === 'string' ? this.sessions.get(g.s) : undefined;
		return s && this.inForce(s) ? s : null;
	}

	// ---- to the local server (§6.3, §6.5, with §12.4's differences) ----

	private local(port: number): { host: string; hostname: string; port: number } {
		if (!port) {
			const app = this.o.targets.appPort();
			return { host: `127.0.0.1:${app}`, hostname: '127.0.0.1', port: app };
		}
		return { host: `localhost:${port}`, hostname: 'localhost', port };
	}

	/** What a relayed request of this session is reported as (the Remotes page's sessions). */
	private context(site: Site, s: Session): RelayContext {
		return {
			sessionId: s.id,
			user: { id: s.credential, name: s.passkey },
			origin: site.app,
			previewOrigin: `https://p{port}.${new URL(site.app).host}`
		};
	}

	private localHeaders(
		incoming: http.IncomingHttpHeaders,
		local: string,
		relay: RelayContext,
		originChecked: boolean,
		websocket = false
	): Record<string, string | string[]> {
		const headers: Record<string, string | string[]> = {};
		for (const [k, v] of Object.entries(incoming)) {
			if (v === undefined || k.startsWith(':') || HOP_BY_HOP.has(k)) continue;
			if (k === 'host' || k === 'origin' || k === 'http2-settings') continue;
			if (k === 'forwarded' || k === 'x-real-ip' || k.startsWith('x-forwarded-')) continue;
			if (k.startsWith('x-wheelhouse-remote')) continue;
			if (!websocket && k.startsWith('sec-websocket-')) continue;
			if (k === 'cookie') {
				const kept = withoutOwnCookies(v);
				if (kept) headers.cookie = kept;
				continue;
			}
			headers[k] = v;
		}
		headers.host = local;
		if (originChecked) headers.origin = `http://${local}`;
		headers['x-wheelhouse-remote'] = '1';
		headers['x-wheelhouse-remote-user'] = relay.user.id;
		headers['x-wheelhouse-remote-session'] = relay.sessionId;
		headers['x-wheelhouse-remote-origin'] = relay.origin;
		headers['x-wheelhouse-remote-preview'] = relay.previewOrigin;
		return headers;
	}

	/**
	 * The local response's headers for the browser: hop-by-hop gone, its
	 * cookies host-only and never ours, a redirect to itself kept on this host,
	 * framing limited (§12.6).
	 */
	private responseHeaders(
		raw: string[],
		local: { hostname: string; port: number },
		site: Site,
		rotated?: string
	): Record<string, string | string[]> {
		const out: Record<string, string | string[]> = {};
		const add = (k: string, v: string) => {
			const prev = out[k];
			out[k] = prev === undefined ? v : Array.isArray(prev) ? [...prev, v] : [prev, v];
		};
		let framing = false;
		for (const [name, value] of headerPairs(raw)) {
			if (HOP_BY_HOP.has(name) || name === 'http2-settings' || name.startsWith(':')) continue;
			if (name === 'set-cookie') {
				if (!ownCookie(value)) add(name, value.replace(/;\s*domain=[^;]*/gi, ''));
				continue;
			}
			if (name === 'content-security-policy' && /(?:^|;)\s*frame-ancestors\b/i.test(value)) {
				framing = true;
			}
			add(name, name === 'location' ? relativeLocation(value, local.hostname, local.port) : value);
		}
		if (!framing) {
			const parent = site.port ? site.app : this.gatewayOrigin;
			add('content-security-policy', `frame-ancestors 'self' ${parent}`);
		}
		if (rotated) {
			add('set-cookie', rotated);
			out['cache-control'] = 'no-store';
		}
		return out;
	}

	/** Streams the request to the local server and its answer back, as they arrive (SSE, uploads). */
	private proxy(
		req: Request,
		res: Response,
		site: Site,
		valid: { entry: Entry; cookie?: string },
		originChecked: boolean
	) {
		const local = this.local(site.port);
		const relay = this.context(site, valid.entry.session);
		this.o.onRelayed?.(relay);
		let answered = false;
		const out = http.request({
			hostname: local.hostname,
			port: local.port,
			method: req.method,
			path: req.url,
			headers: this.localHeaders(req.headers, local.host, relay, originChecked),
			setHost: false
		});
		out.on('response', (lres) => {
			answered = true;
			const headers = this.responseHeaders(lres.rawHeaders, local, site, valid.cookie);
			res.writeHead(lres.statusCode ?? 502, headers);
			lres.pipe(res as NodeJS.WritableStream);
			lres.on('error', () => res.destroy());
		});
		out.on('error', () => {
			if (!answered) this.json(res, 502, { error: 'the local server did not answer' });
			else res.destroy();
		});
		res.on('close', () => {
			if (!res.writableEnded) out.destroy();
		});
		req.pipe(out);
	}

	/** A WebSocket (over HTTP/1.1): only from this host's own origin (§12.6), then piped to the local server as is. */
	private async upgrade(req: http.IncomingMessage, socket: Duplex, head: Buffer, c: Connection) {
		socket.on('error', () => socket.destroy());
		const fail = (status: number) => {
			const reason = http.STATUS_CODES[status] ?? '';
			socket.end(`HTTP/1.1 ${status} ${reason}\r\nconnection: close\r\ncontent-length: 0\r\n\r\n`);
		};
		const site = this.site(req, c);
		if (!site) return fail(421);
		const path = req.url ?? '';
		if (String(req.headers.upgrade).toLowerCase() !== 'websocket' || !goodPath(path)) {
			return fail(400);
		}
		if (req.headers.origin !== site.own) return fail(403);
		const decoded = decodedPath(path);
		if (decoded.toLowerCase().startsWith('/__whm/')) return fail(404);
		const valid = this.validate(req.headers.cookie, site.host);
		if (!valid) return fail(401);
		if (await this.refusal(site.port, decoded)) return fail(403);
		const local = this.local(site.port);
		const relay = this.context(site, valid.entry.session);
		this.o.onRelayed?.(relay);
		const headers = this.localHeaders(req.headers, local.host, relay, true, true);
		headers.connection = 'Upgrade';
		headers.upgrade = 'websocket';
		const out = http.request({
			hostname: local.hostname,
			port: local.port,
			method: 'GET',
			path,
			headers,
			setHost: false
		});
		out.on('upgrade', (lres, lsock, lhead) => {
			const lines = ['HTTP/1.1 101 Switching Protocols'];
			for (const [k, v] of headerPairs(lres.rawHeaders)) {
				if (k !== 'set-cookie' || !ownCookie(v)) lines.push(`${k}: ${v}`);
			}
			if (valid.cookie) lines.push(`set-cookie: ${valid.cookie}`);
			socket.write(`${lines.join('\r\n')}\r\n\r\n`);
			if (lhead.length) socket.write(lhead);
			if (head.length) lsock.write(head);
			lsock.on('error', () => socket.destroy());
			socket.on('close', () => lsock.destroy());
			lsock.on('close', () => socket.destroy());
			lsock.pipe(socket);
			socket.pipe(lsock);
		});
		out.on('response', (lres) => {
			lres.resume();
			fail(lres.statusCode ?? 502);
		});
		out.on('error', () => {
			if (!socket.destroyed) fail(502);
		});
		out.end();
	}

	// ---- answers ----

	private ownHeaders(type: string): Record<string, string> {
		return {
			'content-type': type,
			'cache-control': 'no-store',
			'x-content-type-options': 'nosniff',
			'referrer-policy': 'no-referrer',
			'content-security-policy': `default-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'self' ${this.gatewayOrigin}`
		};
	}

	private json(res: Response, status: number, body: unknown) {
		res.writeHead(status, this.ownHeaders('application/json'));
		res.end(JSON.stringify(body));
	}

	private text(res: Response, status: number, body: string) {
		res.writeHead(status, this.ownHeaders('text/plain; charset=utf-8'));
		res.end(body);
	}

	/** A page asked for before sign-in: nothing of Wheelhouse, only a note. */
	private signinFirst(res: Response) {
		this.text(res, 401, 'Sign in to this machine with a passkey it trusts first.');
	}

	private redirect(res: Response, location: string, cookie?: string) {
		res.writeHead(302, {
			location,
			'cache-control': 'no-store',
			'referrer-policy': 'no-referrer',
			...(cookie ? { 'set-cookie': cookie } : {})
		});
		res.end();
	}

	private log(line: string) {
		this.o.log?.(line);
	}
}

/** A small JSON request body, or undefined when it is missing, too large or not JSON. */
function readJson(req: Request): Promise<unknown> {
	return new Promise((resolve) => {
		const chunks: Buffer[] = [];
		let size = 0;
		req.on('data', (c: Buffer) => {
			size += c.length;
			if (size <= MAX_JSON) chunks.push(c);
		});
		req.on('end', () => {
			if (size > MAX_JSON) return resolve(undefined);
			try {
				resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null'));
			} catch {
				resolve(undefined);
			}
		});
		req.on('error', () => resolve(undefined));
	});
}
