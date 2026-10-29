#!/usr/bin/env node
/**
 * A small MCP server with one MCP app, for Wheelhouse's tests and as an
 * example: Streamable HTTP at `/mcp`, no dependencies.
 *
 * - `show_status` (the app's tool) greets `name` and shows a count. Its UI is
 *   `ui://demo/status.html`, offered only to clients that advertise the
 *   `io.modelcontextprotocol/ui` extension; others get it without one.
 * - `refresh_status` (app only, read-only) reads the count again.
 * - `bump_count` (app only, not read-only) adds one to it.
 * - `model_only` is offered to the agent but not to apps.
 *
 * `GET /health` answers `{ "name": "mcp-app-demo" }`; `GET /state` says what
 * clients sent (the initialize params and every tool call), for tests.
 *
 *   node server.mjs --port 4391 [--sse]
 *
 * With `--sse`, each answer comes as an event stream, after a log notification.
 */
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

const UI = 'io.modelcontextprotocol/ui';
const MIME = 'text/html;profile=mcp-app';
const VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26'];

/** The app itself: plain JavaScript speaking the MCP Apps bridge over postMessage. */
export const APP_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Demo status</title>
<style>
	:root { color-scheme: light dark; }
	body {
		margin: 0; padding: 16px;
		font: 14px/1.5 var(--font-sans, system-ui, sans-serif);
		color: var(--color-text-primary, #14213d);
		background: var(--color-background-primary, #f6f2e9);
	}
	h1 { margin: 0 0 4px; font-size: 18px; font-weight: 600; }
	p { margin: 0 0 12px; color: var(--color-text-secondary, #585448); }
	button {
		font: inherit; padding: 4px 12px; margin-right: 8px; cursor: pointer;
		color: var(--color-text-primary, #14213d);
		background: var(--color-background-secondary, #fffdf7);
		border: 1px solid var(--color-border-primary, #d6cdb8);
		border-radius: var(--border-radius-md, 6px);
	}
	#log { margin-top: 12px; font-size: 12px; color: var(--color-text-secondary, #585448); }
</style>
</head>
<body>
<h1 id="greeting">Waiting for the host…</h1>
<p>Count: <strong id="count">–</strong> · theme <span id="theme">?</span></p>
<button id="refresh" type="button">Refresh</button>
<button id="bump" type="button">Bump</button>
<button id="tell" type="button">Tell Firstmate</button>
<button id="link" type="button">Open the spec</button>
<button id="full" type="button">Full screen</button>
<div id="log"></div>
<script>
	let next = 1;
	const pending = new Map();
	const $ = (id) => document.getElementById(id);
	const log = (t) => { $('log').textContent = t; };
	let mode = 'inline';
	const showMode = (m) => {
		mode = m;
		$('full').textContent = m === 'fullscreen' ? 'Inline' : 'Full screen';
	};
	function request(method, params) {
		const id = next++;
		window.parent.postMessage({ jsonrpc: '2.0', id, method, params }, '*');
		return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
	}
	const notify = (method, params) => window.parent.postMessage({ jsonrpc: '2.0', method, params }, '*');
	function applyContext(ctx) {
		if (!ctx) return;
		if (ctx.displayMode) showMode(ctx.displayMode);
		if (ctx.theme) {
			$('theme').textContent = ctx.theme;
			document.documentElement.style.colorScheme = ctx.theme;
		}
		const vars = ctx.styles && ctx.styles.variables;
		if (vars) for (const [k, v] of Object.entries(vars)) document.documentElement.style.setProperty(k, v);
	}
	function show(result) {
		const s = (result && result.structuredContent) || {};
		if (s.greeting) $('greeting').textContent = s.greeting;
		if (typeof s.count === 'number') $('count').textContent = String(s.count);
	}
	window.addEventListener('message', (event) => {
		const m = event.data;
		if (!m || m.jsonrpc !== '2.0') return;
		if (m.id !== undefined && !m.method) {
			const p = pending.get(m.id);
			if (!p) return;
			pending.delete(m.id);
			if (m.error) p.reject(new Error(m.error.message));
			else p.resolve(m.result);
			return;
		}
		if (m.method === 'ui/notifications/tool-input') log('Input: ' + JSON.stringify(m.params.arguments));
		else if (m.method === 'ui/notifications/tool-result') show(m.params);
		else if (m.method === 'ui/notifications/tool-cancelled') log('Cancelled: ' + m.params.reason);
		else if (m.method === 'ui/notifications/host-context-changed') applyContext(m.params);
		else if (m.method === 'ui/resource-teardown') {
			window.parent.postMessage({ jsonrpc: '2.0', id: m.id, result: {} }, '*');
		}
	});
	const call = (name) =>
		request('tools/call', { name, arguments: {} }).then(show, (e) => log(name + ': ' + e.message));
	$('refresh').onclick = () => call('refresh_status');
	$('bump').onclick = () => call('bump_count');
	$('tell').onclick = () =>
		request('ui/message', { role: 'user', content: [{ type: 'text', text: 'The demo app says hello.' }] })
			.then(() => log('Sent to Firstmate.'), (e) => log('Not sent: ' + e.message));
	$('link').onclick = () =>
		request('ui/open-link', { url: 'https://modelcontextprotocol.io/extensions/apps' }).catch((e) => log(e.message));
	$('full').onclick = () =>
		request('ui/request-display-mode', { mode: mode === 'fullscreen' ? 'inline' : 'fullscreen' })
			.then((r) => showMode(r.mode), (e) => log(e.message));
	request('ui/initialize', {
		protocolVersion: '2026-01-26',
		appInfo: { name: 'demo-status', version: '1.0.0' },
		appCapabilities: { availableDisplayModes: ['inline', 'fullscreen'] }
	}).then((r) => {
		applyContext(r.hostContext);
		notify('ui/notifications/initialized', {});
		const size = () => {
			// The body's own height, not the frame's, so the app can shrink as well as grow.
			const r = document.body.getBoundingClientRect();
			notify('ui/notifications/size-changed', {
				width: Math.ceil(r.width),
				height: Math.ceil(r.height)
			});
		};
		new ResizeObserver(size).observe(document.body);
		size();
	});
</script>
</body>
</html>
`;

/**
 * @typedef {{ jsonrpc: '2.0', id?: string | number, method?: string, params?: any }} Message
 * @typedef {{ name: string, arguments: Record<string, unknown> }} Call
 */

/** The server's tools; the app's UI only for a client that can show it. */
const TOOLS = (/** @type {boolean} */ ui) => [
	{
		name: 'show_status',
		title: 'Show status',
		description: 'Greets someone and shows the count.',
		inputSchema: { type: 'object', properties: { name: { type: 'string' } } },
		annotations: { readOnlyHint: true },
		...(ui ? { _meta: { ui: { resourceUri: 'ui://demo/status.html' } } } : {})
	},
	{
		name: 'refresh_status',
		title: 'Refresh status',
		description: 'Reads the count again.',
		inputSchema: { type: 'object', properties: {} },
		annotations: { readOnlyHint: true },
		_meta: { ui: { resourceUri: 'ui://demo/status.html', visibility: ['app'] } }
	},
	{
		name: 'bump_count',
		title: 'Bump the count',
		description: 'Adds one to the count.',
		inputSchema: { type: 'object', properties: {} },
		_meta: { ui: { visibility: ['app'] } }
	},
	{
		name: 'model_only',
		description: 'For the agent alone.',
		inputSchema: { type: 'object', properties: {} },
		_meta: { ui: { visibility: ['model'] } }
	}
];

/** Start the server; resolves once it listens. `port: 0` picks one. */
export async function startMcpAppServer({ port = 0, sse = false } = {}) {
	/** @type {Map<string, { ui: boolean }>} */
	const sessions = new Map();
	/** @type {{ initialize: unknown[], calls: Call[] }} */
	const state = { initialize: [], calls: [] };
	let count = 0;

	/** @param {string} name @param {Record<string, any>} args */
	const result = (name, args) => {
		state.calls.push({ name, arguments: args });
		if (name === 'bump_count') count += 1;
		const greeting =
			name === 'show_status' ? `Hello, ${args?.name ?? 'whoever you are'}!` : undefined;
		return {
			content: [{ type: 'text', text: JSON.stringify({ greeting, count }) }],
			structuredContent: { ...(greeting ? { greeting } : {}), count }
		};
	};

	/** @param {Message} msg @param {{ ui: boolean }} session */
	function answer(msg, session) {
		const { id, method, params } = msg;
		const ok = (/** @type {unknown} */ r) => ({ jsonrpc: '2.0', id, result: r });
		const fail = (/** @type {number} */ code, /** @type {string} */ message) => ({
			jsonrpc: '2.0',
			id,
			error: { code, message }
		});
		switch (method) {
			case 'tools/list':
				return ok({ tools: TOOLS(session.ui) });
			case 'tools/call': {
				const tool = TOOLS(session.ui).find((t) => t.name === params?.name);
				if (!tool) return fail(-32602, `Unknown tool ${params?.name}`);
				return ok(result(tool.name, params.arguments ?? {}));
			}
			case 'resources/read':
				if (params?.uri !== 'ui://demo/status.html') return fail(-32002, 'Resource not found');
				return ok({
					contents: [
						{
							uri: params.uri,
							mimeType: MIME,
							text: APP_HTML,
							_meta: {
								ui: {
									csp: { connectDomains: ['https://api.example.com'], resourceDomains: ['*'] },
									prefersBorder: true
								}
							}
						}
					]
				});
			case 'ping':
				return ok({});
			default:
				return fail(-32601, `Method not found: ${method}`);
		}
	}

	const server = createServer(async (req, res) => {
		const url = new URL(req.url ?? '/', 'http://localhost');
		/** @param {number} status @param {unknown} body */
		const json = (status, body, headers = {}) => {
			res.writeHead(status, { 'content-type': 'application/json', ...headers });
			res.end(JSON.stringify(body));
		};
		if (req.method === 'GET' && url.pathname === '/health')
			return json(200, { name: 'mcp-app-demo' });
		if (req.method === 'GET' && url.pathname === '/state') return json(200, { ...state, count });
		if (url.pathname !== '/mcp') return json(404, { error: 'not found' });
		if (req.method !== 'POST') return json(405, { error: 'POST only' });
		let body = '';
		for await (const chunk of req) body += chunk;
		/** @type {Message} */
		let msg;
		try {
			msg = JSON.parse(body);
		} catch {
			return json(400, {
				jsonrpc: '2.0',
				id: null,
				error: { code: -32700, message: 'Parse error' }
			});
		}
		if (msg.method === 'initialize') {
			const id = randomUUID();
			const caps = msg.params?.capabilities ?? {};
			state.initialize.push(msg.params);
			sessions.set(id, { ui: !!caps.extensions?.[UI]?.mimeTypes?.includes(MIME) });
			const asked = msg.params?.protocolVersion;
			return reply(
				res,
				sse,
				{ 'mcp-session-id': id },
				{
					jsonrpc: '2.0',
					id: msg.id,
					result: {
						protocolVersion: VERSIONS.includes(asked) ? asked : VERSIONS[0],
						capabilities: { tools: {}, resources: {} },
						serverInfo: { name: 'mcp-app-demo', version: '1.0.0' }
					}
				}
			);
		}
		const session = sessions.get(String(req.headers['mcp-session-id'] ?? ''));
		if (!session) return json(404, { error: 'unknown session' });
		if (msg.id === undefined) {
			res.writeHead(202);
			return res.end();
		}
		return reply(res, sse, {}, answer(msg, session));
	});

	await new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(null)));
	const address = /** @type {import('node:net').AddressInfo} */ (server.address());
	return {
		url: `http://127.0.0.1:${address.port}`,
		port: address.port,
		state,
		/** Forget every session, as a restarted server would. */
		forgetSessions: () => sessions.clear(),
		close: () =>
			new Promise((resolve) => {
				server.closeAllConnections();
				server.close(() => resolve(null));
			})
	};
}

/**
 * One answer, as JSON or as an event stream.
 * @param {import('node:http').ServerResponse} res
 * @param {boolean} sse
 * @param {Record<string, string>} headers
 * @param {unknown} message
 */
function reply(res, sse, headers, message) {
	if (!sse) {
		res.writeHead(200, { 'content-type': 'application/json', ...headers });
		return res.end(JSON.stringify(message));
	}
	res.writeHead(200, { 'content-type': 'text/event-stream', ...headers });
	const log = {
		jsonrpc: '2.0',
		method: 'notifications/message',
		params: { level: 'info', data: 'working' }
	};
	res.write(`event: message\ndata: ${JSON.stringify(log)}\n\n`);
	res.end(`event: message\ndata: ${JSON.stringify(message)}\n\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
	const args = process.argv.slice(2);
	const at = args.indexOf('--port');
	const port = at >= 0 ? Number(args[at + 1]) : 4391;
	const s = await startMcpAppServer({ port, sse: args.includes('--sse') });
	console.log(`mcp-app-demo listening on ${s.url}/mcp`);
}
