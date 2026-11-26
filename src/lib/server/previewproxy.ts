import http, {
	type IncomingHttpHeaders,
	type IncomingMessage,
	type ServerResponse
} from 'node:http';
import net from 'node:net';
import type { Duplex } from 'node:stream';
import { onPageOrigin, previewProxyOn, type HostedPreviews } from '../hosted';
import { viaRelay } from './cloud/remote';
import { HOP_BY_HOP } from './cloud/protocol';
import { acceptedHost, originFor } from './session';
import { refuseUpgrade } from './sessions/terminal';

/**
 * Wheelhouse's own preview proxy, for a cloud IDE such as Ona, which forwards
 * only listeners on 0.0.0.0, passes its forward URL as the Host and adds
 * X-Frame-Options to every port it forwards: there a preview on
 * `127.0.0.1:5173` can be framed only from Wheelhouse's own origin. With
 * `WHEELHOUSE_PREVIEW_PROXY=on` (off by default, when none of this exists)
 * Wheelhouse serves `http://127.0.0.1:<port>/…` at `/_p/<port>/…` on its own
 * origin, HTTP and WebSockets:
 *
 *   - only for a Host Wheelhouse answers (loopback, or one
 *     WHEELHOUSE_ALLOWED_HOSTS names), else 421, as for its own pages;
 *   - only to 127.0.0.1, and only on a port Wheelhouse shows (a task's
 *     preview, an address it has shown, a forward, an MCP app sandbox:
 *     runtime.ts currentPreviewPorts, the same ports Wheelhouse Cloud may
 *     relay to) or one WHEELHOUSE_PREVIEW_PORTS names; never Wheelhouse's own
 *     server port, nor the Firstmate session's; anything else is a 404;
 *   - with the Host rewritten to the loopback address, a redirect to it
 *     (`Location`) rewritten to its `/_p/<port>/` address, and the
 *     page's Origin to the preview's own; Wheelhouse's session token, and the
 *     headers its own servers trust, never reach the preview;
 *   - with X-Frame-Options dropped and the Content-Security-Policy
 *     `sandbox allow-scripts allow-forms allow-popups` added to every
 *     response (beside the preview's own policies, which still apply): a page
 *     served on Wheelhouse's origin always runs as an opaque origin, so it
 *     can neither read Wheelhouse's pages nor change anything in it (which
 *     takes Wheelhouse's origin and session token).
 *
 * The pages open previews here through the preview URL pattern `/_p/{port}`
 * (lib/hosted.ts), the default while the proxy is on.
 */

export const PREVIEW_PORTS_ENV = 'WHEELHOUSE_PREVIEW_PORTS';
export const PROXY_PREFIX = '/_p/';
/** The policy every proxied response carries, so its page is never Wheelhouse's own origin. */
export const PROXY_CSP = 'sandbox allow-scripts allow-forms allow-popups';
/**
 * The origin of the Wheelhouse page a proxied request came from, as the proxy
 * names it (removed from what the browser sent): the MCP app sandbox lets
 * that page frame it (apps/sandbox.ts).
 */
export const PROXY_ORIGIN_HEADER = 'x-wheelhouse-proxy-origin';

/** Headers that are Wheelhouse's own business, never passed to a preview. */
const OWN_HEADERS = /^x-wheelhouse-/i;

/** The ports a list such as `5173, 8080` names, and the entries that are not ports. */
export function parsePreviewPorts(raw: string | undefined): { ports: number[]; invalid: string[] } {
	const ports = new Set<number>();
	const invalid: string[] = [];
	for (const entry of (raw ?? '').split(',')) {
		const e = entry.trim();
		if (!e) continue;
		const n = Number(e);
		if (/^\d{1,5}$/.test(e) && n >= 1 && n <= 65535) ports.add(n);
		else invalid.push(e);
	}
	return { ports: [...ports], invalid };
}

/**
 * Where a request under `/_p/` goes: the port and the path on it, a redirect
 * to the port's root for `/_p/<port>` with no slash after it, or null for
 * anything else (a port with a leading zero, out of range, or no port).
 */
export function proxyTarget(
	url: string
): { port: number; path: string } | { redirect: string } | null {
	const m = /^\/_p\/([1-9]\d{0,4})(\/[^?#]*)?(\?[^#]*)?$/.exec(url);
	if (!m) return null;
	const port = Number(m[1]);
	if (port > 65535) return null;
	if (m[2] === undefined) return { redirect: `${PROXY_PREFIX}${port}/${m[3] ?? ''}` };
	return { port, path: `${m[2]}${m[3] ?? ''}` };
}

/** Whether the proxy may open `port`: one Wheelhouse shows or was told to, never one of its own. */
export function portAllowed(
	port: number,
	o: { shown: readonly number[]; extra: readonly number[]; own: readonly number[] }
): boolean {
	return !o.own.includes(port) && (o.shown.includes(port) || o.extra.includes(port));
}

const LOOPBACK_NAMES = new Set(['127.0.0.1', 'localhost', '[::1]', '0.0.0.0']);

/**
 * A preview's redirect as the proxied page must follow it: to the preview
 * itself (an absolute address on this computer on the same port, or a path
 * from its root) at its `/_p/<port>/` address; any other is left as it is.
 */
export function proxiedLocation(location: string, port: number): string {
	const prefix = `${PROXY_PREFIX}${port}`;
	if (location.startsWith('/') && !location.startsWith('//') && !location.startsWith('/\\')) {
		return prefix + location;
	}
	const u = URL.parse(location);
	if (!u || (u.protocol !== 'http:' && u.protocol !== 'https:') || u.username || u.password) {
		return location;
	}
	const at = Number(u.port || (u.protocol === 'https:' ? 443 : 80));
	if (!LOOPBACK_NAMES.has(u.hostname.toLowerCase()) || at !== port) return location;
	return `${prefix}${u.pathname}${u.search}${u.hash}`;
}

/**
 * The request headers a preview gets: its own Host and Origin, none of
 * Wheelhouse's, and no hop-by-hop headers but a WebSocket handshake's.
 */
export function upstreamHeaders(
	headers: IncomingHttpHeaders,
	port: number,
	servedOrigin: string,
	{ websocket = false }: { websocket?: boolean } = {}
): IncomingHttpHeaders {
	const out: IncomingHttpHeaders = {};
	for (const [name, value] of Object.entries(headers)) {
		if (OWN_HEADERS.test(name) || name === 'referer') continue;
		if (HOP_BY_HOP.has(name) && !(websocket && (name === 'connection' || name === 'upgrade')))
			continue;
		out[name] = value;
	}
	out.host = `127.0.0.1:${port}`;
	// A Wheelhouse page (or the sandbox it frames) asks as the preview's own page; any other Origin
	// (`null` from a proxied page, another site's) is passed on for the preview to judge.
	if (out.origin === servedOrigin) out.origin = `http://127.0.0.1:${port}`;
	// The MCP app sandbox lets the Wheelhouse page that asked frame it (apps/sandbox.ts).
	out[PROXY_ORIGIN_HEADER] = servedOrigin;
	return out;
}

/** The response headers the proxied page gets: never X-Frame-Options, always the sandbox policy. */
export function proxiedResponseHeaders(
	headers: IncomingHttpHeaders,
	port: number
): http.OutgoingHttpHeaders {
	const out: http.OutgoingHttpHeaders = {};
	for (const [name, value] of Object.entries(headers)) {
		if (name === 'x-frame-options' || HOP_BY_HOP.has(name) || value === undefined) continue;
		out[name] = value;
	}
	if (typeof out.location === 'string') out.location = proxiedLocation(out.location, port);
	// A comma joins separate serialized policies in one header (CSP3), each enforced on its
	// own and the strictest result winning per directive - the same as two separate
	// Content-Security-Policy headers. So the sandbox applies no matter what the upstream
	// sends, and an upstream sandbox directive (or any other directive) cannot loosen it.
	// A semicolon would instead merge everything into one policy, where a second `sandbox`
	// directive is simply ignored - letting an upstream `sandbox allow-same-origin` give the
	// page Wheelhouse's own origin instead of the opaque one this proxy promises.
	const own: string | string[] | undefined = headers['content-security-policy'];
	return {
		...out,
		'content-security-policy': [...(own === undefined ? [] : [own].flat()), PROXY_CSP].join(', ')
	};
}

/**
 * Whether the page that sent `request` frames previews through the proxy: it
 * is on, the preview URL pattern in use is a path on the page's origin
 * (`/_p/{port}`), and the page did not come through Wheelhouse Cloud, which
 * opens previews on the relay instead.
 */
export function proxiedFraming(
	request: Request,
	hosted: HostedPreviews | null,
	env: Record<string, string | undefined>
): boolean {
	return previewProxyOn(env) && !!hosted && onPageOrigin(hosted.pattern) && !viaRelay(request);
}

export interface PreviewProxyOptions {
	env?: Record<string, string | undefined>;
	/** The ports Wheelhouse shows now (runtime.ts currentPreviewPorts). */
	shownPorts(): Promise<number[]>;
	/** Wheelhouse's own ports the proxy never opens, beyond the one a request came in on. */
	ownPorts(): Promise<number[]>;
	log?(message: string): void;
}

/** How long the shown ports are kept between requests (a page's many assets ask at once). */
const SHOWN_MS = 1_000;

export class PreviewProxy {
	private readonly env: Record<string, string | undefined>;
	private readonly extra: number[];
	private shown: { at: number; ports: Promise<number[]> } | null = null;

	constructor(private readonly opts: PreviewProxyOptions) {
		this.env = opts.env ?? process.env;
		const { ports, invalid } = parsePreviewPorts(this.env[PREVIEW_PORTS_ENV]);
		this.extra = ports;
		if (invalid.length) {
			opts.log?.(
				`Wheelhouse: ${PREVIEW_PORTS_ENV} names ${invalid.join(', ')}, which ${invalid.length === 1 ? 'is not a port' : 'are not ports'}; ignored.`
			);
		}
	}

	/** Whether the proxy is on (WHEELHOUSE_PREVIEW_PROXY=on). */
	get on(): boolean {
		return previewProxyOn(this.env);
	}

	/** Whether `req` is for the proxy: it is on, and the path is under `/_p/`. */
	handles(req: IncomingMessage): boolean {
		return this.on && (req.url ?? '').startsWith(PROXY_PREFIX);
	}

	/** Take an HTTP request under `/_p/`; false leaves any other to Wheelhouse. */
	request(req: IncomingMessage, res: ServerResponse): boolean {
		if (!this.handles(req)) return false;
		void this.check(req).then(
			(v) => {
				if ('status' in v) return send(res, v.status, v.message, v.location);
				this.forward(req, res, v.port, v.path, v.origin);
			},
			() => send(res, 500, 'Wheelhouse could not tell which ports it shows.')
		);
		return true;
	}

	/** Take a WebSocket upgrade under `/_p/`; false leaves any other to its server. */
	upgrade(req: IncomingMessage, socket: Duplex, head: Buffer): boolean {
		if (!this.handles(req)) return false;
		socket.on('error', () => socket.destroy());
		void this.check(req).then(
			(v) => {
				if ('status' in v) return refuseUpgrade(socket, v.status, v.message);
				this.tunnel(req, socket, head, v.port, v.path, v.origin);
			},
			() => socket.destroy()
		);
		return true;
	}

	/** Where the request may go, or why not. */
	async check(
		req: IncomingMessage
	): Promise<
		| { port: number; path: string; origin: string }
		| { status: number; message: string; location?: string }
	> {
		const host = req.headers.host ?? '';
		if (!acceptedHost(host, this.env)) return { status: 421, message: 'Misdirected request' };
		const target = proxyTarget(req.url ?? '');
		if (!target) return { status: 404, message: 'Not found' };
		if ('redirect' in target) return { status: 308, message: '', location: target.redirect };
		const own = [
			...(await this.opts.ownPorts()),
			...(req.socket.localPort ? [req.socket.localPort] : [])
		];
		const allowed = portAllowed(target.port, {
			shown: await this.shownPorts(),
			extra: this.extra,
			own
		});
		if (!allowed) return { status: 404, message: 'Not found' };
		return { ...target, origin: originFor(host, req.headers['x-forwarded-proto'], this.env) };
	}

	private shownPorts(): Promise<number[]> {
		const now = Date.now();
		if (!this.shown || now - this.shown.at > SHOWN_MS) {
			this.shown = { at: now, ports: this.opts.shownPorts() };
			this.shown.ports.catch(() => (this.shown = null));
		}
		return this.shown.ports;
	}

	private forward(
		req: IncomingMessage,
		res: ServerResponse,
		port: number,
		path: string,
		origin: string
	): void {
		const out = http.request(
			{
				host: '127.0.0.1',
				port,
				path,
				method: req.method,
				headers: upstreamHeaders(req.headers, port, origin)
			},
			(up) => {
				res.writeHead(up.statusCode ?? 502, proxiedResponseHeaders(up.headers, port));
				up.pipe(res);
				up.on('error', () => res.destroy());
			}
		);
		out.on('error', () => {
			if (res.headersSent) return res.destroy();
			send(res, 502, `Nothing answers on port ${port} right now.`);
		});
		res.on('close', () => out.destroy());
		req.pipe(out);
	}

	private tunnel(
		req: IncomingMessage,
		socket: Duplex,
		head: Buffer,
		port: number,
		path: string,
		origin: string
	): void {
		const headers = upstreamHeaders(req.headers, port, origin, { websocket: true });
		let open = false;
		const up = net.connect(port, '127.0.0.1', () => {
			open = true;
			const lines = [`${req.method ?? 'GET'} ${path} HTTP/1.1`];
			for (const [name, value] of Object.entries(headers)) {
				if (value === undefined) continue;
				for (const v of [value].flat()) lines.push(`${name}: ${v}`);
			}
			up.write(lines.join('\r\n') + '\r\n\r\n');
			if (head.length) up.write(head);
			up.pipe(socket);
			socket.pipe(up);
		});
		up.on('error', () => {
			if (open) socket.destroy();
			else refuseUpgrade(socket, 502, `Nothing answers on port ${port} right now.`);
		});
		socket.on('error', () => up.destroy());
		socket.on('close', () => up.destroy());
	}
}

function send(res: ServerResponse, status: number, message: string, location?: string): void {
	res.writeHead(status, {
		'content-type': 'text/plain; charset=utf-8',
		'cache-control': 'no-store',
		'x-content-type-options': 'nosniff',
		...(location ? { location } : {})
	});
	res.end(message);
}
