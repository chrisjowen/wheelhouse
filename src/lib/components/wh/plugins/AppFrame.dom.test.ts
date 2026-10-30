import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppOpenView } from '$lib/apps/types';
import type { SlotEntry } from '$lib/plugins/types';
import AppFrame from './AppFrame.svelte';

vi.mock('$app/state', () => ({
	page: { data: { sessionToken: 'tok', health: { version: '1.2.3' } } }
}));

const SANDBOX = 'http://127.0.0.1:5999';

const entry: SlotEntry = {
	key: 'demo/status',
	slot: 'nav.page',
	pluginId: 'demo',
	contributionId: 'status',
	title: 'Demo status',
	order: 500,
	step: null,
	projectId: null,
	render: { app: { server: 'mcp', tool: 'show' } },
	badge: null,
	content: { available: true, value: { name: 'Ada' }, source: 'a test', observedAt: null }
};

const frameProps = {
	ref: {
		plugin: entry.pluginId,
		contribution: entry.contributionId,
		project: entry.projectId,
		task: entry.taskId ?? null
	},
	title: entry.title,
	plugin: entry.pluginId
};

const ready: AppOpenView = {
	schema: 'wheelhouse-app.v1',
	state: 'ready',
	server: { id: 'mcp', title: 'Demo server' },
	tool: { name: 'show', inputSchema: { type: 'object' } },
	html: '<!doctype html><p>app</p>',
	csp: { connectDomains: ['https://api.example.com'] },
	prefersBorder: true,
	input: { name: 'Ada' },
	sandbox: `${SANDBOX}/sandbox.html?csp=${encodeURIComponent(JSON.stringify({ connectDomains: ['https://api.example.com'] }))}&sig=signed`
};

type Call = { url: string; body: Record<string, unknown>; headers: Record<string, string> };
let calls: Call[];
let answers: Record<string, (body: Record<string, unknown>) => [number, unknown]>;

beforeEach(() => {
	calls = [];
	answers = {
		'/api/apps/open': () => [200, ready],
		'/api/apps/run': () => [200, { ok: true, result: { content: [], structuredContent: { n: 1 } } }]
	};
	vi.stubGlobal(
		'fetch',
		vi.fn(async (url: string, init: RequestInit) => {
			const body = JSON.parse(String(init.body ?? '{}'));
			calls.push({ url, body, headers: init.headers as Record<string, string> });
			const [status, data] = answers[url]?.(body) ?? [404, { message: 'no' }];
			return new Response(JSON.stringify(data), { status });
		})
	);
});
afterEach(() => {
	document.body.innerHTML = '';
	vi.unstubAllGlobals();
});

const settle = async () => {
	for (let i = 0; i < 5; i++) {
		await new Promise((r) => setTimeout(r, 0));
		flushSync();
	}
};

/** The frame, what the page posted into it, and a way to send it what the sandbox would. */
function frame() {
	const el = document.querySelector('iframe')!;
	const posted: { message: Record<string, unknown>; origin: string }[] = [];
	// happy-dom loads no frames: the sandbox's window is a stand-in the page posts to.
	const sandbox = {
		postMessage: (message: Record<string, unknown>, origin: string) =>
			posted.push({ message, origin })
	};
	Object.defineProperty(el, 'contentWindow', { get: () => sandbox });
	const send = (data: unknown, origin = SANDBOX, source: unknown = sandbox) =>
		window.dispatchEvent(new MessageEvent('message', { data, origin, source: source as Window }));
	return { el, posted, send };
}

describe('an MCP app in a slot', () => {
	it('frames the sandbox on its own origin, under the app’s policy, and hands it the app', async () => {
		const c = mount(AppFrame, { target: document.body, props: frameProps });
		await settle();
		expect(calls[0]).toMatchObject({
			url: '/api/apps/open',
			body: { plugin: 'demo', contribution: 'status', project: null, task: null },
			headers: { 'x-wheelhouse-session': 'tok' }
		});
		const { el, posted, send } = frame();
		const src = new URL(el.src);
		expect(src.origin).toBe(SANDBOX);
		expect(src.searchParams.get('host')).toBe(location.origin);
		expect(JSON.parse(src.searchParams.get('csp')!)).toEqual(ready.state === 'ready' && ready.csp);
		expect(src.searchParams.get('sig')).toBe('signed');
		expect(el.getAttribute('sandbox')).toBe('allow-scripts allow-same-origin allow-forms');
		expect(document.body.textContent).toContain('it may reach https://api.example.com');

		// Another page, or the right page from another origin, is not listened to.
		send({ jsonrpc: '2.0', method: 'ui/notifications/sandbox-proxy-ready' }, 'https://evil.test');
		send({ jsonrpc: '2.0', method: 'ui/notifications/sandbox-proxy-ready' }, SANDBOX, window);
		// Nor another server's app, from its own sandbox origin.
		send(
			{ jsonrpc: '2.0', method: 'ui/notifications/sandbox-proxy-ready' },
			'http://127.0.0.1:6001'
		);
		send(
			{ jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'show', arguments: {} } },
			'http://127.0.0.1:6001'
		);
		await settle();
		expect(posted).toEqual([]);
		expect(calls.map((c) => c.url)).not.toContain('/api/apps/call');

		send({ jsonrpc: '2.0', method: 'ui/notifications/sandbox-proxy-ready', params: {} });
		expect(posted[0]).toEqual({
			message: {
				jsonrpc: '2.0',
				method: 'ui/notifications/sandbox-resource-ready',
				params: {
					html: '<!doctype html><p>app</p>',
					csp: { connectDomains: ['https://api.example.com'] }
				}
			},
			origin: SANDBOX
		});

		send({ jsonrpc: '2.0', id: 1, method: 'ui/initialize', params: { appCapabilities: {} } });
		await settle();
		expect(posted[1].message).toMatchObject({
			id: 1,
			result: {
				hostInfo: { name: 'wheelhouse', version: '1.2.3' },
				hostContext: {
					toolInfo: { tool: { name: 'show' } },
					theme: 'light',
					displayMode: 'inline',
					platform: 'web'
				}
			}
		});
		// Nothing reaches the app before it says it is initialized; then its input, then the result.
		expect(posted).toHaveLength(2);
		send({ jsonrpc: '2.0', method: 'ui/notifications/initialized' });
		await settle();
		expect(posted.slice(2).map((p) => p.message)).toEqual([
			{
				jsonrpc: '2.0',
				method: 'ui/notifications/tool-input',
				params: { arguments: { name: 'Ada' } }
			},
			{
				jsonrpc: '2.0',
				method: 'ui/notifications/tool-result',
				params: { content: [], structuredContent: { n: 1 } }
			}
		]);
		unmount(c);
	});

	it('runs a tool that may change something only once the captain agrees', async () => {
		answers['/api/apps/call'] = (body) =>
			body.confirmed
				? [200, { ok: true, result: { content: [{ type: 'text', text: 'done' }] } }]
				: [
						409,
						{
							ok: false,
							reason: 'may change something',
							confirm: { tool: 'bump', title: 'Bump it', description: 'Adds one.' }
						}
					];
		const c = mount(AppFrame, { target: document.body, props: frameProps });
		await settle();
		const { posted, send } = frame();
		send({
			jsonrpc: '2.0',
			id: 7,
			method: 'tools/call',
			params: { name: 'bump', arguments: { by: 2 } }
		});
		await settle();
		const dialog = document.querySelector('dialog')!;
		expect(dialog.textContent).toContain('Let the app run “Bump it”?');
		expect(dialog.textContent).toContain('"by": 2');
		expect(posted).toEqual([]);
		[...dialog.querySelectorAll('button')]
			.find((b) => b.textContent?.includes('Run it once'))!
			.click();
		await settle();
		expect(calls.filter((x) => x.url === '/api/apps/call').map((x) => x.body.confirmed)).toEqual([
			false,
			true
		]);
		expect(posted[0].message).toEqual({
			jsonrpc: '2.0',
			id: 7,
			result: { content: [{ type: 'text', text: 'done' }] }
		});

		send({ jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'bump', arguments: {} } });
		await settle();
		[...document.querySelectorAll<HTMLButtonElement>('dialog button')]
			.find((b) => b.textContent === 'No')!
			.click();
		await settle();
		expect(posted[1].message).toMatchObject({
			id: 8,
			error: { code: -32000, message: 'The captain declined the call.' }
		});
		unmount(c);
	});

	it('hands the app over once; a proxy that loads again gets nothing', async () => {
		const c = mount(AppFrame, { target: document.body, props: frameProps });
		await settle();
		const { posted, send } = frame();
		send({ jsonrpc: '2.0', method: 'ui/notifications/sandbox-proxy-ready', params: {} });
		expect(posted).toHaveLength(1);
		send({ jsonrpc: '2.0', method: 'ui/notifications/sandbox-proxy-ready', params: {} });
		await settle();
		expect(posted).toHaveLength(1);
		unmount(c);
	});

	it('keeps a queued question waiting for the captain after they agree to the first', async () => {
		answers['/api/apps/call'] = (body) =>
			body.confirmed
				? [200, { ok: true, result: { content: [] } }]
				: [
						409,
						{
							ok: false,
							reason: 'may change something',
							confirm: { tool: String(body.name), title: String(body.name), description: null }
						}
					];
		const c = mount(AppFrame, { target: document.body, props: frameProps });
		await settle();
		const { posted, send } = frame();
		send({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'one', arguments: {} } });
		send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'two', arguments: {} } });
		await settle();
		const dialog = document.querySelector('dialog')!;
		expect(dialog.textContent).toContain('Let the app run “one”?');
		[...dialog.querySelectorAll('button')]
			.find((b) => b.textContent?.includes('Run it once'))!
			.click();
		await settle();
		// A browser fires the first dialog's close as a later task, once the next question shows.
		dialog.dispatchEvent(new Event('close'));
		await settle();
		expect(posted.map((p) => p.message)).toEqual([
			{ jsonrpc: '2.0', id: 1, result: { content: [] } }
		]);
		expect(dialog.open).toBe(true);
		expect(dialog.textContent).toContain('Let the app run “two”?');
		unmount(c);
	});

	it('offers to start the server’s service, then opens the app', async () => {
		let up = false;
		answers['/api/apps/open'] = () =>
			up
				? [200, ready]
				: [
						200,
						{
							schema: 'wheelhouse-app.v1',
							state: 'service',
							server: { id: 'mcp', title: 'Demo server' },
							service: {
								plugin: 'demo',
								service: 'mcp',
								project: null,
								title: 'the demo server',
								state: 'stopped',
								launchable: true,
								reason: null,
								hint: null
							}
						}
					];
		answers['/api/services'] = () => {
			up = true;
			return [200, { state: 'running' }];
		};
		const c = mount(AppFrame, { target: document.body, props: frameProps });
		await settle();
		expect(document.body.textContent).toContain(
			'The app runs on the demo server, which is not running.'
		);
		document.querySelector<HTMLButtonElement>('[data-app-service] button')!.click();
		await settle();
		expect(calls.find((x) => x.url === '/api/services')).toMatchObject({
			body: { plugin: 'demo', service: 'mcp', project: null },
			headers: { 'x-wheelhouse-session': 'tok' }
		});
		expect(document.querySelector('iframe')).not.toBeNull();
		unmount(c);
	});

	it('says why an app cannot open', async () => {
		answers['/api/apps/open'] = () => [
			200,
			{
				schema: 'wheelhouse-app.v1',
				state: 'unavailable',
				reason: 'Demo server has no tool “show”.'
			}
		];
		const c = mount(AppFrame, { target: document.body, props: frameProps });
		await settle();
		expect(document.body.textContent).toContain('Not available. Demo server has no tool “show”.');
		expect(document.querySelector('iframe')).toBeNull();
		unmount(c);
	});
});
