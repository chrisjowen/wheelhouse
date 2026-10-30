import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { cspHeader } from '../../apps/csp';
import type { AppCsp } from '../../apps/types';
import { LOOPBACK_HOST } from '../session';

/**
 * The sandbox MCP apps run in: a loopback server for each MCP server, on a
 * port of its own, so it is another origin from Wheelhouse's pages and from
 * every other server's apps. It serves one page,
 * the sandbox proxy, and nothing else. The page Wheelhouse draws an app in
 * frames it, sends it the app's HTML, and the proxy loads that in an inner
 * frame and relays the app's messages to and from the page, as the MCP Apps
 * spec lays out for a web host. The app's Content-Security-Policy is the
 * proxy page's own response header (built from the origins the app
 * declared, passed in `?csp=` and signed in `?sig=` with a key only this
 * sandbox holds, so no page can ask it for another policy), which the inner
 * frame inherits and cannot change; `frame-ancestors` lets only the Wheelhouse
 * page named in `?host=`
 * frame it. Its origin can change nothing in Wheelhouse: Wheelhouse takes
 * changes only from its own origin with the session token, and sends no CORS
 * headers, so the sandbox cannot read its API either.
 */

export const SANDBOX_PATH = '/sandbox.html';

/** A Wheelhouse page's origin: plain http on loopback. */
const HOST_ORIGIN = /^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d{1,5})?$/;

/**
 * The proxy: makes the inner frame, loads the app's HTML into it when the
 * host sends `sandbox-resource-ready`, and relays every other message both
 * ways, taking from the parent only what the host origin sent.
 */
function proxyScript(host: string): string {
	return `(() => {
	const HOST = ${JSON.stringify(host).replace(/</g, '\\u003c')};
	const RESERVED = 'ui/notifications/sandbox-';
	if (window.self === window.top) return;
	const inner = document.createElement('iframe');
	inner.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms');
	inner.setAttribute('title', 'MCP app');
	document.body.appendChild(inner);
	let loaded = false;
	const reserved = (m) => !!m && typeof m.method === 'string' && m.method.startsWith(RESERVED);
	window.addEventListener('message', (event) => {
		const m = event.data;
		if (event.source === window.parent) {
			if (event.origin !== HOST) return;
			if (reserved(m)) {
				if (m.method !== RESERVED + 'resource-ready' || loaded) return;
				const html = m.params && m.params.html;
				if (typeof html !== 'string') return;
				loaded = true;
				const doc = inner.contentDocument;
				if (doc) {
					doc.open();
					doc.write(html);
					doc.close();
				} else {
					inner.srcdoc = html;
				}
				return;
			}
			if (inner.contentWindow) inner.contentWindow.postMessage(m, '*');
		} else if (event.source === inner.contentWindow) {
			if (reserved(m)) return;
			window.parent.postMessage(m, HOST);
		}
	});
	window.parent.postMessage({ jsonrpc: '2.0', method: RESERVED + 'proxy-ready', params: {} }, HOST);
})();`;
}

export function sandboxPage(host: string): string {
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="referrer" content="no-referrer">
<title>MCP app sandbox</title>
<style>html,body{margin:0;height:100%;overflow:hidden;background:transparent}iframe{display:block;border:0;width:100%;height:100%}</style>
</head>
<body>
<script>${proxyScript(host)}</script>
</body>
</html>
`;
}

/** The signature of a policy (its `?csp=` text) under a sandbox's key. */
export function signCsp(key: Buffer, csp: string): string {
	return createHmac('sha256', key).update(csp).digest('base64url');
}

function signedBy(key: Buffer, csp: string, sig: string): boolean {
	const want = Buffer.from(signCsp(key, csp));
	const got = Buffer.from(sig);
	return got.length === want.length && timingSafeEqual(got, want);
}

/** The sandbox's whole answer to one request, taking only a policy signed with `key`. */
export const sandboxHandler =
	(key: Buffer) =>
	(req: IncomingMessage, res: ServerResponse): void => {
		const send = (status: number, text: string) => {
			res.writeHead(status, {
				'content-type': 'text/plain; charset=utf-8',
				'cache-control': 'no-store',
				'x-content-type-options': 'nosniff'
			});
			res.end(text);
		};
		// Loopback only, as for Wheelhouse itself: any other Host means a DNS-rebinding page.
		if (!LOOPBACK_HOST.test(req.headers.host ?? '')) return send(421, 'Misdirected request');
		if (req.method !== 'GET' && req.method !== 'HEAD') return send(405, 'Only GET');
		const url = new URL(req.url ?? '/', 'http://sandbox');
		if (url.pathname !== SANDBOX_PATH)
			return send(404, 'This port serves only the MCP app sandbox.');
		const host = url.searchParams.get('host') ?? '';
		if (!HOST_ORIGIN.test(host))
			return send(400, 'Name the Wheelhouse page that frames the sandbox.');
		const raw = url.searchParams.get('csp') ?? '';
		if (!signedBy(key, raw, url.searchParams.get('sig') ?? ''))
			return send(400, 'The app’s CSP is not the one Wheelhouse signed.');
		let csp: unknown;
		try {
			csp = JSON.parse(raw);
		} catch {
			return send(400, 'The app’s CSP is not JSON.');
		}
		const body = sandboxPage(host);
		res.writeHead(200, {
			'content-type': 'text/html; charset=utf-8',
			'content-security-policy': `${cspHeader(csp)}; frame-ancestors ${host}`,
			'cache-control': 'no-store',
			'x-content-type-options': 'nosniff',
			'referrer-policy': 'no-referrer'
		});
		res.end(req.method === 'HEAD' ? undefined : body);
	};

/** One sandbox server: on loopback, on a port the system picks, with a key of its own. */
export class SandboxServer {
	private readonly key = randomBytes(32);
	private server: Server | null = null;
	private address: string | null = null;
	private failure: string | null = null;

	async start(): Promise<void> {
		const server = createServer(sandboxHandler(this.key));
		await new Promise<void>((resolve) => {
			server.once('error', (e) => {
				this.failure = `The MCP app sandbox could not start: ${e.message}`;
				resolve();
			});
			server.listen(0, '127.0.0.1', () => {
				const a = server.address();
				if (typeof a === 'object' && a) this.address = `http://127.0.0.1:${a.port}`;
				resolve();
			});
		});
		if (this.address) {
			server.unref();
			this.server = server;
		}
	}

	/** The sandbox page for an app with policy `csp`, signed, or why there is none. */
	url(csp: AppCsp): { url: string } | { reason: string } {
		if (!this.address) return { reason: this.failure ?? 'The MCP app sandbox is not running.' };
		const u = new URL(SANDBOX_PATH, this.address);
		const raw = JSON.stringify(csp);
		u.searchParams.set('csp', raw);
		u.searchParams.set('sig', signCsp(this.key, raw));
		return { url: u.href };
	}

	close(): void {
		this.server?.close();
		this.server?.closeAllConnections();
		this.server = null;
		this.address = null;
	}
}

/**
 * The sandboxes, one for each MCP server (keyed by plugin, server and the
 * project its service runs for), each started the first time one of its apps
 * opens, so each server's apps are cross-origin to every other's.
 */
export class Sandboxes {
	private readonly started = new Map<string, Promise<SandboxServer>>();

	/** The sandbox page for server `key`'s app with policy `csp`, or why there is none. */
	async url(key: string, csp: AppCsp): Promise<{ url: string } | { reason: string }> {
		let at = this.started.get(key);
		if (!at) {
			const sandbox = new SandboxServer();
			at = sandbox.start().then(() => sandbox);
			this.started.set(key, at);
		}
		const url = (await at).url(csp);
		if (!('url' in url)) this.started.delete(key);
		return url;
	}

	close(): void {
		for (const at of this.started.values()) void at.then((s) => s.close());
		this.started.clear();
	}
}
