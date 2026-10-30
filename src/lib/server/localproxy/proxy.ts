import {
	request as httpRequest,
	type IncomingHttpHeaders,
	type IncomingMessage,
	type OutgoingHttpHeaders,
	type ServerResponse
} from 'node:http';
import { connect, type Socket } from 'node:net';
import type { Duplex } from 'node:stream';
import { proxiedUrl, proxyPort, settingPorts } from '../../localproxy';
import { refuseUpgrade } from '../sessions/terminal';

/**
 * The localhost proxy (see lib/localproxy.ts for its addresses). It answers
 * only requests whose Host is `<port>.localhost` on Wheelhouse's own port,
 * and only while the bundled Localhost proxy plugin is on; with the plugin
 * off such a request is refused as Wheelhouse has always refused a foreign
 * Host. It forwards to that port on this computer's loopback (127.0.0.1, else
 * ::1) and nowhere else: the target host is never taken from the request.
 *
 * It opens a port only when the crew has reported an address on it, or the
 * plugin's settings list it; never Wheelhouse's own port or its MCP app
 * sandboxes. As on Wheelhouse's own routes, a request that changes anything,
 * and every WebSocket, must come from the proxied page's own origin, so
 * another site open in the browser cannot post to a local app through it.
 * The proxied app sees its own address (Host and Origin are rewritten to
 * `localhost:<port>`), and redirects and cookies it sends are rewritten to
 * the proxied address. Bodies pass through untouched.
 */

export interface LocalProxyOptions {
	/** The plugin's settings while it is on, else null. */
	settings: () => Promise<Record<string, unknown> | null>;
	/** Whether the crew has reported an address on this port. */
	reported: (port: number) => Promise<boolean>;
	/** Ports never opened, beyond the one Wheelhouse itself is answering on. */
	reserved: () => number[];
	/** The loopback addresses tried in turn; tests may narrow them. */
	targets?: string[];
	connectTimeoutMs?: number;
}

type Verdict = { ok: true; port: number } | { ok: false; status: number; page: string };

/** Hop-by-hop headers, never passed on in either direction. */
const HOP = new Set([
	'connection',
	'keep-alive',
	'proxy-connection',
	'proxy-authenticate',
	'proxy-authorization',
	'te',
	'trailer',
	'upgrade'
]);

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export class LocalProxy {
	private readonly targets: string[];
	private readonly connectTimeoutMs: number;

	constructor(private readonly opts: LocalProxyOptions) {
		this.targets = opts.targets ?? ['127.0.0.1', '::1'];
		this.connectTimeoutMs = opts.connectTimeoutMs ?? 3_000;
	}

	/** Take an HTTP request if its Host is a proxied address; false leaves it to Wheelhouse. */
	request(req: IncomingMessage, res: ServerResponse): boolean {
		if (proxyPort(req.headers.host) === null) return false;
		void this.forward(req, res).catch(() => {
			if (!res.headersSent) send(res, 502, page(NOT_ANSWERING));
			else res.destroy();
		});
		return true;
	}

	/** Take a WebSocket upgrade if its Host is a proxied address; false leaves it to Wheelhouse. */
	upgrade(req: IncomingMessage, socket: Duplex, head: Buffer): boolean {
		if (proxyPort(req.headers.host) === null) return false;
		socket.on('error', () => socket.destroy());
		void this.tunnel(req, socket, head).catch(() => socket.destroy());
		return true;
	}

	/** Whether this request may go through, and to which port. */
	async check(req: IncomingMessage, upgrade: boolean): Promise<Verdict> {
		const host = (req.headers.host ?? '').toLowerCase();
		const port = proxyPort(host)!;
		const settings = await this.opts.settings();
		// Off: exactly what Wheelhouse answers any foreign Host.
		if (!settings) return { ok: false, status: 421, page: 'Misdirected request' };
		const own = req.socket.localPort;
		if (port === own || this.opts.reserved().includes(port)) {
			return { ok: false, status: 403, page: page(ownPort(port)) };
		}
		const listed = settingPorts(settings.ports).includes(port);
		if (!listed && !(await this.opts.reported(port))) {
			return { ok: false, status: 403, page: page(notShared(port, host, req.url ?? '/')) };
		}
		const origin = req.headers.origin;
		if (
			(upgrade || !SAFE_METHODS.has((req.method ?? 'GET').toUpperCase())) &&
			origin !== served(host)
		) {
			return {
				ok: false,
				status: 403,
				page: origin
					? `Requests from ${origin} are not accepted.`
					: 'Requests that change anything must carry an Origin header.'
			};
		}
		return { ok: true, port };
	}

	private async forward(req: IncomingMessage, res: ServerResponse): Promise<void> {
		const verdict = await this.check(req, false);
		if (!verdict.ok) return send(res, verdict.status, verdict.page);
		const upstream = await this.connect(verdict.port);
		if (!upstream) return send(res, 502, page(NOT_ANSWERING));
		const host = (req.headers.host ?? '').toLowerCase();
		const out = httpRequest({
			createConnection: () => upstream,
			method: req.method,
			path: req.url,
			headers: requestHeaders(req.headers, verdict.port, host, false)
		});
		out.on('response', (up) => {
			res.writeHead(up.statusCode ?? 502, up.statusMessage, responseHeaders(up.headers, host));
			up.pipe(res);
			up.on('error', () => res.destroy());
		});
		out.on('error', () => {
			if (!res.headersSent) send(res, 502, page(NOT_ANSWERING));
			else res.destroy();
		});
		res.on('close', () => out.destroy());
		req.pipe(out);
	}

	private async tunnel(req: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
		const verdict = await this.check(req, true);
		if (!verdict.ok) return refuse(socket, verdict.status, verdict.page);
		const upstream = await this.connect(verdict.port);
		if (!upstream) return refuse(socket, 502, 'Nothing is answering on that port.');
		const host = (req.headers.host ?? '').toLowerCase();
		const out = httpRequest({
			createConnection: () => upstream,
			method: req.method,
			path: req.url,
			headers: requestHeaders(req.headers, verdict.port, host, true)
		});
		out.on('upgrade', (up, upSocket, upHead) => {
			upSocket.on('error', () => socket.destroy());
			socket.on('close', () => upSocket.destroy());
			upSocket.on('close', () => socket.destroy());
			socket.write(statusLine(up) + rawHeaders(up.rawHeaders, host));
			if (upHead.length) socket.write(upHead);
			if (head.length) upSocket.write(head);
			upSocket.pipe(socket).pipe(upSocket);
		});
		// The app answered without switching protocols: pass that answer on and close.
		out.on('response', (up) => {
			socket.write(statusLine(up) + rawHeaders(up.rawHeaders, host, ['connection']));
			up.pipe(socket);
		});
		out.on('error', () => socket.destroy());
		out.end();
	}

	/** A connection to the port on loopback, trying each address in turn; null when none answers. */
	private async connect(port: number): Promise<Socket | null> {
		for (const host of this.targets) {
			const socket = await new Promise<Socket | null>((resolve) => {
				const s = connect({ host, port });
				const timer = setTimeout(() => {
					s.destroy();
					resolve(null);
				}, this.connectTimeoutMs);
				s.once('connect', () => {
					clearTimeout(timer);
					resolve(s);
				});
				s.once('error', () => {
					clearTimeout(timer);
					resolve(null);
				});
			});
			if (socket) return socket;
		}
		return null;
	}
}

/** The origin a proxied page was served from, as its Host names it. */
const served = (host: string) => `http://${host}`;

/** The headers passed on to the app: hop-by-hop removed, its own address in Host, Origin and Referer. */
export function requestHeaders(
	headers: IncomingHttpHeaders,
	port: number,
	host: string,
	upgrade: boolean
): OutgoingHttpHeaders {
	const listed = new Set(
		String(headers.connection ?? '')
			.split(',')
			.map((h) => h.trim().toLowerCase())
	);
	const out: OutgoingHttpHeaders = {};
	for (const [name, value] of Object.entries(headers)) {
		if (value === undefined || HOP.has(name) || listed.has(name)) continue;
		out[name] = value;
	}
	const own = `http://localhost:${port}`;
	out.host = `localhost:${port}`;
	if (out.origin === served(host)) out.origin = own;
	const referer = typeof out.referer === 'string' ? out.referer : null;
	if (referer?.startsWith(`${served(host)}/`))
		out.referer = own + referer.slice(served(host).length);
	if (upgrade) {
		out.connection = 'Upgrade';
		out.upgrade = headers.upgrade;
	}
	return out;
}

/** The app's response headers for the viewer: hop-by-hop removed, redirects and cookies rewritten. */
export function responseHeaders(headers: IncomingHttpHeaders, host: string): OutgoingHttpHeaders {
	const out: OutgoingHttpHeaders = {};
	for (const [name, value] of Object.entries(headers)) {
		if (value === undefined || HOP.has(name)) continue;
		out[name] = value;
	}
	if (typeof out.location === 'string') out.location = rewriteLocation(out.location, host);
	if (Array.isArray(out['set-cookie'])) out['set-cookie'] = out['set-cookie'].map(hostOnlyCookie);
	return out;
}

/**
 * A redirect to an address on this computer, through the proxy (the same
 * app's own address becomes the proxied page's origin); any other is kept.
 */
export function rewriteLocation(location: string, host: string): string {
	const [hostname, port = ''] = host.split(':');
	return proxiedUrl(location, { protocol: 'http:', hostname, port });
}

/** A cookie kept to the proxied address alone: any Domain attribute is dropped. */
export function hostOnlyCookie(cookie: string): string {
	return cookie.replace(/;\s*domain=[^;]*/gi, '');
}

function statusLine(up: IncomingMessage): string {
	return `HTTP/1.1 ${up.statusCode} ${up.statusMessage ?? ''}\r\n`;
}

/** A raw response head for a socket, with Location and cookies rewritten as for any response. */
function rawHeaders(raw: string[], host: string, drop: string[] = []): string {
	let head = '';
	for (let i = 0; i + 1 < raw.length; i += 2) {
		const name = raw[i];
		let value = raw[i + 1];
		const lower = name.toLowerCase();
		if (drop.includes(lower)) continue;
		if (lower === 'location') value = rewriteLocation(value, host);
		if (lower === 'set-cookie') value = hostOnlyCookie(value);
		head += `${name}: ${value}\r\n`;
	}
	return `${head}${drop.includes('connection') ? 'Connection: close\r\n' : ''}\r\n`;
}

function send(res: ServerResponse, status: number, body: string): void {
	const html = body.startsWith('<!doctype html>');
	res.writeHead(status, {
		'content-type': html ? 'text/html; charset=utf-8' : 'text/plain; charset=utf-8',
		'cache-control': 'no-store',
		'x-content-type-options': 'nosniff'
	});
	res.end(body);
}

/** Refuse an upgrade in plain words; a page explaining why is for the browser's own requests. */
function refuse(socket: Duplex, status: number, body: string): void {
	refuseUpgrade(
		socket,
		status,
		body.startsWith('<!doctype html>') ? 'Not shared through Wheelhouse.' : body
	);
}

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

interface Explained {
	title: string;
	lines: string[];
}

const NOT_ANSWERING: Explained = {
	title: 'Nothing is answering here',
	lines: [
		'Wheelhouse passed this address on to its own computer, but nothing answered on that port.',
		'If a preview was running there, it has stopped. Ask the crew to start it again, then reload this page.'
	]
};

function ownPort(port: number): Explained {
	return {
		title: 'Not shared through Wheelhouse',
		lines: [`Port ${port} is Wheelhouse’s own, which its localhost proxy never opens.`]
	};
}

function notShared(port: number, host: string, path: string): Explained {
	const direct = `http://localhost:${port}${path.startsWith('/') ? path : '/'}`;
	const at = host.split(':')[1];
	const settings = `http://localhost${at ? `:${at}` : ''}/settings/plugins/localhost-proxy`;
	return {
		title: 'Not shared through Wheelhouse',
		lines: [
			`Wheelhouse’s localhost proxy opens only the ports the crew has reported an address on, and those its settings list. Nothing has reported port ${port}.`,
			`To open it anyway, add ${port} to <b>More ports to allow</b> on the Localhost proxy’s page under <a href="${escape(settings)}">Settings → Plugins</a>, then reload this page.`,
			`On Wheelhouse’s own computer you can also open it directly: <a href="${escape(direct)}">${escape(direct)}</a>.`
		]
	};
}

/** A small page in Wheelhouse's own colours that says, in plain words, why. */
function page({ title, lines }: Explained): string {
	return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
:root{color-scheme:light dark;--bg:#f7f3ea;--fg:#14233c;--muted:#5b6578;--sea:#1f5f8b;--rule:#d9d1c0}
@media (prefers-color-scheme:dark){:root{--bg:#0f1a2c;--fg:#ece6d8;--muted:#a3abba;--sea:#7fb4dc;--rule:#2a3a55}}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.6 system-ui,-apple-system,sans-serif}
main{max-width:40rem;padding:3rem 1rem}
h1{font:600 1.5rem/1.3 Georgia,serif;margin:0 0 1rem;padding-bottom:.75rem;border-bottom:1px solid var(--rule)}
p{margin:0 0 .75rem;color:var(--muted)}a{color:var(--sea)}b{color:var(--fg)}
</style></head>
<body><main><h1>${title}</h1>${lines.map((l) => `<p>${l}</p>`).join('')}</main></body></html>`;
}
