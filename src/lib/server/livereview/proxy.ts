import http from 'node:http';
import net from 'node:net';
import { promisify } from 'node:util';
import zlib from 'node:zlib';
import { loopbackPreview } from '$lib/preview';
import recorderSource from './recorder.js?raw';
import shooterSource from 'modern-screenshot/dist/index.js?raw';

/**
 * A live review's view of a preview (see lib/livereview.ts): the task's
 * loopback preview, served again from a port of its own on 127.0.0.1 with the
 * recorder added to every HTML page, so Wheelhouse hears what the captain does
 * on it. Everything else passes through unchanged (WebSockets too, for a dev
 * server's reloads), except that headers forbidding the page from being
 * framed are dropped: this copy exists only to be framed by Wheelhouse.
 *
 * One proxy per preview origin and Wheelhouse origin, made on first use and
 * closed after it has been idle for a while. The recorder only ever talks to
 * the Wheelhouse origin it was made for.
 */

export const RECORDER_PATH = '/__wheelhouse/live-review/recorder.js';
export const SHOOTER_PATH = '/__wheelhouse/live-review/screenshot.js';
const IDLE_MS = 30 * 60_000;
const HTML_MAX_BYTES = 8 * 1024 * 1024;

interface Proxy {
	server: http.Server;
	origin: string;
	last: number;
}

const proxies = new Map<string, Promise<Proxy>>();

/** The recorder's script tag, first thing in the page's head. */
export function injectRecorder(html: string): string {
	const tag = `<script src="${RECORDER_PATH}" data-wheelhouse-live-review></script>`;
	const head = /<head(?:\s[^>]*)?>/i.exec(html);
	if (head)
		return (
			html.slice(0, head.index + head[0].length) + tag + html.slice(head.index + head[0].length)
		);
	const doctype = /<!doctype[^>]*>/i.exec(html);
	if (doctype)
		return (
			html.slice(0, doctype.index + doctype[0].length) +
			tag +
			html.slice(doctype.index + doctype[0].length)
		);
	return tag + html;
}

const gunzip = promisify(zlib.gunzip);
const inflate = promisify(zlib.inflate);
const brotli = promisify(zlib.brotliDecompress);

async function decoded(body: Buffer, encoding: string | undefined): Promise<Buffer> {
	const e = (encoding ?? '').trim().toLowerCase();
	if (e === 'gzip' || e === 'x-gzip') return gunzip(body);
	if (e === 'deflate') return inflate(body);
	if (e === 'br') return brotli(body);
	return body;
}

/** Response headers as the framed copy sends them. */
function passedHeaders(
	headers: http.IncomingHttpHeaders,
	upstream: URL,
	self: string
): http.OutgoingHttpHeaders {
	const out: http.OutgoingHttpHeaders = { ...headers };
	delete out['content-security-policy'];
	delete out['content-security-policy-report-only'];
	delete out['x-frame-options'];
	if (typeof out.location === 'string' && out.location.startsWith(upstream.origin)) {
		out.location = self + out.location.slice(upstream.origin.length);
	}
	return out;
}

function serveScript(res: http.ServerResponse, source: string) {
	res.writeHead(200, {
		'content-type': 'text/javascript; charset=utf-8',
		'cache-control': 'no-store'
	});
	res.end(source);
}

function start(upstream: URL, parentOrigin: string, key: string): Promise<Proxy> {
	const recorder = recorderSource.replaceAll('__WHEELHOUSE_ORIGIN__', parentOrigin);
	const proxy: Proxy = { server: http.createServer(), origin: '', last: Date.now() };
	const { server } = proxy;
	server.on('request', (req, res) => {
		proxy.last = Date.now();
		const path = (req.url ?? '/').split('?')[0];
		if (path === RECORDER_PATH) return serveScript(res, recorder);
		if (path === SHOOTER_PATH) return serveScript(res, shooterSource);
		const headers = { ...req.headers, host: upstream.host, 'accept-encoding': 'gzip, deflate, br' };
		if (typeof headers.origin === 'string') headers.origin = upstream.origin;
		delete headers.referer;
		const out = http.request(
			{
				hostname: upstream.hostname,
				port: upstream.port,
				path: req.url,
				method: req.method,
				headers
			},
			(r) => {
				const h = passedHeaders(r.headers, upstream, proxy.origin);
				if (!String(r.headers['content-type'] ?? '').includes('text/html')) {
					res.writeHead(r.statusCode ?? 200, h);
					r.pipe(res);
					return;
				}
				const chunks: Buffer[] = [];
				let size = 0;
				r.on('data', (c: Buffer) => {
					size += c.length;
					if (size <= HTML_MAX_BYTES) chunks.push(c);
				});
				r.on('end', async () => {
					try {
						if (size > HTML_MAX_BYTES) throw new Error('too large');
						const html = await decoded(Buffer.concat(chunks), r.headers['content-encoding']);
						const body = Buffer.from(injectRecorder(html.toString('utf8')));
						delete h['content-encoding'];
						delete h['transfer-encoding'];
						h['content-length'] = body.length;
						res.writeHead(r.statusCode ?? 200, h);
						res.end(body);
					} catch {
						res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
						res.end('Wheelhouse could not read this page to record it.');
					}
				});
			}
		);
		out.on('error', () => {
			if (res.headersSent) return res.destroy();
			res.writeHead(502, { 'content-type': 'text/html; charset=utf-8' });
			res.end(
				injectRecorder(
					'<!doctype html><html><head><title>Preview stopped</title></head><body style="font:15px system-ui;padding:40px;color:#555">The preview did not answer.</body></html>'
				)
			);
		});
		req.pipe(out);
	});
	// WebSockets (a dev server's live reload) go straight through.
	server.on('upgrade', (req, socket, head) => {
		proxy.last = Date.now();
		const up = net.connect(Number(upstream.port) || 80, upstream.hostname, () => {
			const lines = [`${req.method} ${req.url} HTTP/${req.httpVersion}`];
			for (let i = 0; i < req.rawHeaders.length; i += 2) {
				const name = req.rawHeaders[i];
				lines.push(
					`${name}: ${name.toLowerCase() === 'host' ? upstream.host : req.rawHeaders[i + 1]}`
				);
			}
			up.write(lines.join('\r\n') + '\r\n\r\n');
			if (head.length) up.write(head);
			up.pipe(socket);
			socket.pipe(up);
		});
		up.on('error', () => socket.destroy());
		socket.on('error', () => up.destroy());
	});
	return new Promise((resolve, reject) => {
		server.once('error', reject);
		server.listen(0, '127.0.0.1', () => {
			const address = server.address() as net.AddressInfo;
			proxy.origin = `http://127.0.0.1:${address.port}`;
			const idle = setInterval(() => {
				if (Date.now() - proxy.last < IDLE_MS) return;
				clearInterval(idle);
				server.close();
				server.closeAllConnections();
				proxies.delete(key);
			}, 60_000);
			idle.unref();
			resolve(proxy);
		});
	});
}

/**
 * The address of the recorded copy of a loopback preview, for a page served
 * at `parentOrigin`: the preview's own path on the proxy's origin. Refused for
 * anything not on this machine.
 */
export async function recordedPreview(
	previewUrl: string,
	parentOrigin: string
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
	const target = loopbackPreview(previewUrl);
	if (!target.ok) return { ok: false, error: target.reason };
	const upstream = new URL(target.url);
	const parent = URL.parse(parentOrigin);
	if (!parent || !['127.0.0.1', 'localhost', '[::1]'].includes(parent.hostname)) {
		return {
			ok: false,
			error: 'Live review works only when Wheelhouse is opened on this computer.'
		};
	}
	const key = `${upstream.origin} ${parent.origin}`;
	let p = proxies.get(key);
	if (!p) {
		p = start(upstream, parent.origin, key);
		proxies.set(key, p);
		p.catch(() => proxies.delete(key));
	}
	try {
		const proxy = await p;
		proxy.last = Date.now();
		return { ok: true, url: proxy.origin + upstream.pathname + upstream.search + upstream.hash };
	} catch {
		return { ok: false, error: 'Wheelhouse could not open a port to record the preview.' };
	}
}

/** Close every proxy (tests, and shutdown). */
export async function closeRecordedPreviews(): Promise<void> {
	const all = [...proxies.values()];
	proxies.clear();
	for (const p of all) {
		const proxy = await p.catch(() => null);
		if (!proxy) continue;
		proxy.server.closeAllConnections();
		await new Promise<void>((r) => proxy.server.close(() => r()));
	}
}
