import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { cspHeader } from '../../apps/csp';
import { LOOPBACK_HOST } from '../session';

/**
 * The sandbox MCP apps run in: a second loopback server, on a port of its
 * own, so it is another origin from Wheelhouse's pages. It serves one page,
 * the sandbox proxy, and nothing else. The page Wheelhouse draws an app in
 * frames it, sends it the app's HTML, and the proxy loads that in an inner
 * frame and relays the app's messages to and from the page, as the MCP Apps
 * spec lays out for a web host. The app's Content-Security-Policy is the
 * proxy page's own response header (built from the origins the app
 * declared, passed in `?csp=`), which the inner frame inherits and cannot
 * change; `frame-ancestors` lets only the Wheelhouse page named in `?host=`
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

/** The sandbox's whole answer to one request. */
export function handleSandbox(req: IncomingMessage, res: ServerResponse): void {
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
	if (url.pathname !== SANDBOX_PATH) return send(404, 'This port serves only the MCP app sandbox.');
	const host = url.searchParams.get('host') ?? '';
	if (!HOST_ORIGIN.test(host))
		return send(400, 'Name the Wheelhouse page that frames the sandbox.');
	let csp: unknown = undefined;
	const raw = url.searchParams.get('csp');
	if (raw) {
		try {
			csp = JSON.parse(raw);
		} catch {
			return send(400, 'The app’s CSP is not JSON.');
		}
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
}

/** The sandbox server: started once, on loopback, on a port the system picks. */
export class SandboxServer {
	private server: Server | null = null;
	private address: string | null = null;
	private failure: string | null = null;

	async start(): Promise<void> {
		const server = createServer(handleSandbox);
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

	/** The sandbox page's address, or why there is none. */
	url(): { url: string } | { reason: string } {
		return this.address
			? { url: `${this.address}${SANDBOX_PATH}` }
			: { reason: this.failure ?? 'The MCP app sandbox is not running.' };
	}

	close(): void {
		this.server?.close();
		this.server?.closeAllConnections();
		this.server = null;
		this.address = null;
	}
}
