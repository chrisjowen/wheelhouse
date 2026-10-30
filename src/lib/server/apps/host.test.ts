import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startMcpAppServer } from '../../../../tests/fixtures/mcp-app-demo/mcp/server.mjs';
import type { AppRef } from '../../apps/types';
import type { ServiceView } from '../../plugins/types';
import type { Project, TaskSummary } from '../../types';
import { EMPTY_CONFIG } from '../plugins/config';
import { loadOne } from '../plugins/loader';
import type { ServicePorts } from '../plugins/ports';
import { PluginRegistry } from '../plugins/registry';
import type { ToolCall } from '../sessions/transcript';
import { AppHost, appHtml, chatResult, endpointUrl } from './host';
import { Sandboxes, SANDBOX_PATH } from './sandbox';

/**
 * The MCP app host, end to end against the example plugin in
 * tests/fixtures/mcp-app-demo: loaded through the installed-plugin loader,
 * filled by the registry, its MCP server running as its companion service.
 */

const FIXTURES = path.resolve('tests/fixtures');
const project = { id: 'alpha', name: 'alpha', registered: true, path: null } as Project;
const tasks = [{ id: 'a-1', projectId: 'alpha' } as TaskSummary];
const ref: AppRef = { plugin: 'mcp-app-demo', contribution: 'status', project: null, task: null };

let server: Awaited<ReturnType<typeof startMcpAppServer>>;
let registry: PluginRegistry;
let running = true;
let log: string[] = [];
let host: AppHost;
/** Firstmate's MCP tool calls, as the chat's transcript holds them. */
let calls: Record<string, ToolCall>;
const sandboxes = new Sandboxes();

beforeAll(async () => {
	server = await startMcpAppServer();
	const loaded = await loadOne(FIXTURES, 'mcp-app-demo', null);
	if (!loaded.ok) throw new Error(loaded.status.reason ?? 'did not load');
	registry = new PluginRegistry(
		[],
		{
			fleet: () => ({ projects: [project], tasks }),
			worktree: () => null,
			config: async () => ({ config: EMPTY_CONFIG, error: null }),
			// The service's port is the one the test server listens on.
			servicePorts: { port: async () => server.port } as unknown as ServicePorts
		},
		{ plugins: [loaded.plugin] }
	);
});
afterAll(() => {
	server.close();
	sandboxes.close();
});

const text = (t: string) => ({ content: [{ type: 'text' as const, text: t }], isError: false });

beforeEach(() => {
	running = true;
	log = [];
	calls = {
		c1: {
			id: 'c1',
			name: 'mcp__demo__show_status',
			input: { name: 'Ada' },
			result: text(JSON.stringify({ greeting: 'Hello, Ada!', count: 7 }))
		},
		c2: { id: 'c2', name: 'mcp__demo__model_only', input: {}, result: text('done') },
		c3: { id: 'c3', name: 'mcp__elsewhere__show_status', input: {}, result: text('{}') },
		c4: { id: 'c4', name: 'mcp__plugin_mcp-app-demo_demo__show_status', input: {}, result: null },
		c5: {
			id: 'c5',
			name: 'mcp__plugin_mcp-app-demo_demo__show_status',
			input: {},
			result: { tooLarge: true }
		}
	};
	host = new AppHost({
		toolCall: (id) => calls[id] ?? null,
		registry,
		serviceView: async (q) =>
			({
				schema: 'wheelhouse-service.v1',
				...q,
				title: 'the demo MCP server',
				state: running ? 'running' : 'stopped',
				url: server.url,
				reason: null,
				launchable: !running,
				hint: null
			}) satisfies ServiceView,
		sandbox: (key, csp) => sandboxes.url(key, csp),
		version: '1.0.0',
		log: (line) => log.push(line)
	});
});

describe('the MCP app host', () => {
	it('loads a plugin that declares an MCP server and an app', () => {
		expect(registry.status()[0]).toMatchObject({ id: 'mcp-app-demo', state: 'loaded' });
	});

	it('opens the app: its HTML, its declared origins, the tool and the provider’s arguments', async () => {
		const v = await host.open(ref);
		expect(v).toMatchObject({
			state: 'ready',
			server: { id: 'demo', title: 'Demo server' },
			tool: { name: 'show_status', _meta: { ui: { resourceUri: 'ui://demo/status.html' } } },
			// The server's `resourceDomains: ['*']` is dropped: only plain origins get in.
			csp: { connectDomains: ['https://api.example.com'] },
			prefersBorder: true,
			input: { name: 'the captain (1 task in the fleet)' }
		});
		expect(v?.state === 'ready' && v.html).toContain('ui/initialize');
		// The server's own sandbox, which serves the policy Wheelhouse signed for it.
		if (v?.state !== 'ready') throw new Error('not ready');
		const page = new URL(v.sandbox);
		expect(page.pathname).toBe(SANDBOX_PATH);
		expect(JSON.parse(page.searchParams.get('csp')!)).toEqual(v.csp);
		page.searchParams.set('host', 'http://127.0.0.1:4310');
		const served = await fetch(page);
		expect(served.status).toBe(200);
		expect(served.headers.get('content-security-policy')).toContain(
			"connect-src 'self' https://api.example.com"
		);
		const again = await host.open(ref);
		expect(again?.state === 'ready' && new URL(again.sandbox).origin).toBe(page.origin);
		expect(log.join('\n')).toContain("connect-src 'self' https://api.example.com");
	});

	it('offers to start the server’s service when it is not running', async () => {
		running = false;
		expect(await host.open(ref)).toMatchObject({
			state: 'service',
			service: { plugin: 'mcp-app-demo', service: 'mcp', launchable: true }
		});
	});

	it('runs the app’s tool with the provider’s arguments', async () => {
		expect(await host.run(ref)).toMatchObject({
			ok: true,
			result: { structuredContent: { greeting: 'Hello, the captain (1 task in the fleet)!' } }
		});
	});

	it('lets the app call its own read-only app tools, and logs each call', async () => {
		expect(await host.call(ref, 'refresh_status', {}, false)).toMatchObject({
			ok: true,
			result: { structuredContent: { count: expect.any(Number) } }
		});
		expect(log).toContain('MCP app mcp-app-demo/demo: the app called refresh_status (read-only).');
	});

	it('refuses tools the server keeps from apps, or does not have', async () => {
		expect(await host.call(ref, 'model_only', {}, true)).toMatchObject({
			ok: false,
			refused: true,
			reason: '“model_only” is not offered to apps.'
		});
		expect(await host.call(ref, 'rm_rf', {}, true)).toMatchObject({ ok: false, refused: true });
		expect(server.state.calls.map((c: { name: string }) => c.name)).not.toContain('model_only');
	});

	it('runs a tool that may change something only once the captain agrees', async () => {
		const before = server.state.calls.length;
		expect(await host.call(ref, 'bump_count', {}, false)).toMatchObject({
			ok: false,
			confirm: {
				tool: 'bump_count',
				title: 'Bump the count',
				description: 'Adds one to the count.'
			}
		});
		expect(server.state.calls).toHaveLength(before);
		expect(await host.call(ref, 'bump_count', {}, true)).toMatchObject({
			ok: true,
			result: { structuredContent: { count: 1 } }
		});
		expect(log).toContain(
			'MCP app mcp-app-demo/demo: the app called bump_count (the captain agreed).'
		);
	});

	it('reads the app’s resources from its own server', async () => {
		expect(await host.read(ref, 'ui://demo/status.html')).toMatchObject({
			ok: true,
			result: { contents: [{ uri: 'ui://demo/status.html' }] }
		});
	});

	it('knows only the plugins’ own app contributions', async () => {
		expect(await host.open({ ...ref, contribution: 'nope' })).toBeNull();
		expect(await host.call({ ...ref, plugin: 'other' }, 'refresh_status', {}, false)).toBeNull();
	});
});

describe('an MCP app in the chat', () => {
	const chat = { chat: 'c1' };

	it('finds the calls to a plugin’s MCP server, with a result, whose tool has a UI', async () => {
		expect(await host.chatApps(['c1', 'c2', 'c3', 'c4', 'c5', 'nope'])).toEqual({
			schema: 'wheelhouse-chat-apps.v1',
			apps: {
				c1: {
					plugin: 'mcp-app-demo',
					server: { id: 'demo', title: 'Demo server' },
					title: 'Show status'
				},
				c5: {
					plugin: 'mcp-app-demo',
					server: { id: 'demo', title: 'Demo server' },
					title: 'Show status'
				}
			}
		});
		// Seen while its server ran, a call still shows once it stops; never seen, it stays text.
		running = false;
		expect(Object.keys((await host.chatApps(['c1'])).apps)).toEqual(['c1']);
		const fresh = new AppHost({
			registry,
			toolCall: (id) => calls[id] ?? null,
			serviceView: async () => null,
			sandbox: (key, csp) => sandboxes.url(key, csp),
			version: '1.0.0'
		});
		expect((await fresh.chatApps(['c1'])).apps).toEqual({});
	});

	it('opens the app with the call’s own arguments, reading only its UI from the server', async () => {
		const before = server.state.calls.length;
		const v = await host.open(chat);
		expect(v).toMatchObject({
			state: 'ready',
			server: { id: 'demo' },
			tool: { name: 'show_status' },
			csp: { connectDomains: ['https://api.example.com'] },
			input: { name: 'Ada' }
		});
		// The result is the one Firstmate had: the tool is not called again.
		expect(await host.run(chat)).toEqual({
			ok: true,
			result: {
				content: [{ type: 'text', text: '{"greeting":"Hello, Ada!","count":7}' }],
				structuredContent: { greeting: 'Hello, Ada!', count: 7 }
			}
		});
		expect(server.state.calls).toHaveLength(before);
		expect(await host.run({ chat: 'c4' })).toMatchObject({ ok: false, reason: /no result yet/ });
		expect(await host.run({ chat: 'c5' })).toMatchObject({ ok: false, reason: /too large/ });
	});

	it('holds what the app asks for to the same policy as in a slot', async () => {
		expect(await host.call(chat, 'refresh_status', {}, false)).toMatchObject({ ok: true });
		expect(await host.call(chat, 'bump_count', {}, false)).toMatchObject({
			ok: false,
			confirm: { tool: 'bump_count' }
		});
		expect(await host.call(chat, 'model_only', {}, true)).toMatchObject({ refused: true });
		expect(await host.read(chat, 'ui://demo/status.html')).toMatchObject({ ok: true });
	});

	it('knows only calls in the transcript to a plugin’s own server', async () => {
		expect(await host.open({ chat: 'nope' })).toBeNull();
		expect(await host.open({ chat: 'c3' })).toBeNull();
		expect(await host.run({ chat: 'c3' })).toBeNull();
		expect(await host.call({ chat: 'nope' }, 'refresh_status', {}, false)).toBeNull();
	});

	it('gives a result that is one JSON object back its structured content', () => {
		expect(chatResult(text('{"a":1}'))).toEqual({
			content: [{ type: 'text', text: '{"a":1}' }],
			structuredContent: { a: 1 }
		});
		expect(chatResult(text('[1]')).structuredContent).toBeUndefined();
		expect(chatResult(text('plain')).structuredContent).toBeUndefined();
		expect(chatResult({ ...text('{}'), isError: true }).isError).toBe(true);
	});
});

describe('an app’s UI resource', () => {
	const read = (item: Record<string, unknown>) =>
		appHtml({ contents: [{ uri: 'ui://a/b', ...item }] }, 'ui://a/b');

	it('must be MCP app HTML, as text or a blob', () => {
		expect(read({ mimeType: 'text/html;profile=mcp-app', text: '<p>hi</p>' })).toMatchObject({
			ok: true,
			value: { html: '<p>hi</p>' }
		});
		expect(
			read({
				mimeType: 'text/html; profile=mcp-app',
				blob: Buffer.from('<b>x</b>').toString('base64')
			})
		).toMatchObject({ ok: true, value: { html: '<b>x</b>' } });
		expect(read({ mimeType: 'text/html', text: '<p>' })).toMatchObject({ ok: false });
		expect(read({ mimeType: 'text/html;profile=mcp-app' })).toMatchObject({ ok: false });
	});
});

describe('an MCP server’s endpoint', () => {
	it('stays on the service’s own loopback address', () => {
		expect(endpointUrl('http://127.0.0.1:4391', '/mcp')).toEqual({
			ok: true,
			value: 'http://127.0.0.1:4391/mcp'
		});
		expect(endpointUrl('http://example.com', '/mcp')).toMatchObject({ ok: false });
		expect(endpointUrl(null, '/mcp')).toMatchObject({ ok: false });
	});
});
