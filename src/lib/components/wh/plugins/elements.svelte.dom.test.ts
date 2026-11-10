import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountElement, pluginHost, type PluginElement } from '$lib/plugins/elements';
import type { ServiceView, SlotEntry } from '$lib/plugins/types';
import BarePanel from './BarePanel.svelte';
import SlotContent from './SlotContent.svelte';

const entry = (o: Partial<SlotEntry> = {}): SlotEntry => ({
	key: 'acme/card@docs',
	slot: 'harbour.card',
	pluginId: 'acme',
	contributionId: 'card',
	title: 'Card',
	order: 500,
	step: null,
	projectId: 'docs',
	render: { element: 'acme-card' },
	ui: '/api/plugins/acme/ui/index.js?v=1',
	badge: null,
	content: { available: true, value: { n: 1 }, source: 'a test', observedAt: null },
	...o
});

/** An element that shows its data as text, as a plugin's bundle would define it. */
function define(tag: string) {
	if (customElements.get(tag)) return;
	customElements.define(
		tag,
		class extends HTMLElement {
			#data: unknown;
			set data(v: unknown) {
				this.#data = v;
				this.textContent = JSON.stringify(v);
			}
			get data() {
				return this.#data;
			}
		}
	);
}

const settle = async () => {
	for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
	flushSync();
};

vi.mock('$app/state', () => ({ page: { data: { sessionToken: 'sekrit' } } }));

afterEach(() => {
	document.body.innerHTML = '';
	vi.unstubAllGlobals();
});

describe('mounting an installed plugin’s element', () => {
	it('imports the bundle once, then creates the element with its data and entry', async () => {
		const urls: string[] = [];
		const importer = async (url: string) => {
			urls.push(url);
			define('acme-once');
		};
		const host = document.createElement('div');
		const e = entry({ render: { element: 'acme-once' }, ui: '/bundle-once.js' });
		const el = await mountElement(host, {
			tag: 'acme-once',
			ui: e.ui,
			data: { n: 2 },
			entry: e,
			importer
		});
		expect(urls).toEqual(['/bundle-once.js']);
		expect(el.parentElement).toBe(host);
		expect(el.data).toEqual({ n: 2 });
		expect(el.entry).toBe(e);
		await mountElement(document.createElement('div'), {
			tag: 'acme-once',
			ui: e.ui,
			data: null,
			entry: e,
			importer
		});
		expect(urls).toHaveLength(1);
	});

	it('says why when the bundle fails, or never defines the tag', async () => {
		const host = document.createElement('div');
		const e = entry();
		await expect(
			mountElement(host, {
				tag: 'acme-broken',
				ui: '/broken.js',
				data: null,
				entry: e,
				importer: async () => {
					throw new Error('404');
				}
			})
		).rejects.toThrow('its UI bundle did not load (404)');
		await expect(
			mountElement(host, {
				tag: 'acme-never',
				ui: '/empty.js',
				data: null,
				entry: e,
				importer: async () => {},
				timeoutMs: 20
			})
		).rejects.toThrow('its UI bundle does not define <acme-never>');
		await expect(
			mountElement(host, { tag: 'acme-nobundle', ui: null, data: null, entry: e })
		).rejects.toThrow('no UI bundle');
		expect(host.children).toHaveLength(0);
	});
});

describe('a slot entry drawn by an element', () => {
	it('mounts the element in the slot with the provider’s value, and hands it new values', async () => {
		define('acme-card');
		const props = $state({ entry: entry() });
		const c = mount(SlotContent, { target: document.body, props });
		await settle();
		const el = document.querySelector<PluginElement>('acme-card')!;
		expect(el).not.toBeNull();
		expect(el.data).toEqual({ n: 1 });
		expect(el.textContent).toBe('{"n":1}');
		expect(document.body.textContent).toContain('From a test.');

		props.entry = entry({
			content: { available: true, value: { n: 5 }, source: 'a test', observedAt: null }
		});
		await settle();
		expect(document.querySelectorAll('acme-card')).toHaveLength(1);
		expect(document.querySelector('acme-card')).toBe(el);
		expect(el.data).toEqual({ n: 5 });
		unmount(c);
	});

	it('says why it could not be shown, in its own place', async () => {
		const c = mount(SlotContent, {
			target: document.body,
			props: { entry: entry({ render: { element: 'acme-missing' }, ui: null }) }
		});
		await settle();
		expect(document.body.textContent).toContain(
			'The acme plugin’s element could not be shown: this Wheelhouse has no UI bundle for it.'
		);
		unmount(c);
	});

	it('shows nothing in the header when an indicator’s element cannot be shown', async () => {
		define('acme-pill');
		const ok = mount(BarePanel, {
			target: document.body,
			props: { entry: entry({ slot: 'header.indicator', render: { element: 'acme-pill' } }) }
		});
		await settle();
		expect(document.querySelector('acme-pill')?.textContent).toBe('{"n":1}');
		unmount(ok);
		const bad = mount(BarePanel, {
			target: document.body,
			props: {
				entry: entry({ slot: 'header.indicator', render: { element: 'acme-gone' }, ui: null })
			}
		});
		await settle();
		expect(document.body.textContent?.trim()).toBe('');
		unmount(bad);
	});
});

describe('the host API an element gets', () => {
	const view = (plugin: string, service: string, project: string | null): ServiceView => ({
		schema: 'wheelhouse-service.v1',
		plugin,
		service,
		project,
		title: 'Viewer',
		state: 'running',
		url: 'http://127.0.0.1:4400',
		reason: null,
		launchable: false,
		hint: null
	});

	it('reads and starts only its own plugin’s services, for its own project by default', async () => {
		const status = vi.fn(async (r: { plugin: string; service: string; project: string | null }) =>
			view(r.plugin, r.service, r.project)
		);
		const launch = vi.fn(async () => null);
		const host = pluginHost(entry(), { status, launch, feedback: vi.fn(), token: () => 'tok' });
		expect(host.pluginId).toBe('acme');
		expect(Object.isFrozen(host)).toBe(true);

		await host.service('viewer');
		await host.service('viewer', { project: null });
		await host.launch('ui', { project: 'other', open: 'http://127.0.0.1:4400/p' });
		// A plugin named in the options is not the element's to choose.
		await host.launch('ui', { plugin: 'docket' } as never);
		expect(status.mock.calls.map((c) => c[0])).toEqual([
			{ plugin: 'acme', service: 'viewer', project: 'docs' },
			{ plugin: 'acme', service: 'viewer', project: null }
		]);
		expect(launch.mock.calls).toEqual([
			[{ plugin: 'acme', service: 'ui', project: 'other' }, 'tok', 'http://127.0.0.1:4400/p'],
			[{ plugin: 'acme', service: 'ui', project: 'docs' }, 'tok', null]
		]);
		await expect(host.launch('')).rejects.toThrow('Name a service.');
	});

	it('sends a feedback list about the entry’s task, or the one named, only on the captain’s click', async () => {
		const feedback = vi.fn(async () => ({ ok: true as const, pending: false }));
		let clicked = false;
		const deps = {
			status: vi.fn(),
			launch: vi.fn(),
			feedback,
			clicked: () => clicked,
			token: () => 'tok'
		};
		const host = pluginHost(entry({ slot: 'task.section', taskId: 'lumen-plan' }), deps);
		const list = {
			subject: 'plan.md',
			items: [{ text: 'Add a rollback step', points: 'line 12' }]
		};

		expect(await host.sendFeedback(list)).toEqual({
			ok: false,
			error: 'Feedback is sent only when the captain clicks to send it.'
		});
		expect(feedback).not.toHaveBeenCalled();

		clicked = true;
		expect(await host.sendFeedback(list)).toEqual({ ok: true, pending: false });
		await host.sendFeedback({ ...list, task: 'lumen-other' });
		// A plugin named in the list is not the element's to choose.
		await host.sendFeedback({ ...list, plugin: 'docket' } as never);
		expect(feedback.mock.calls).toEqual([
			['acme', { taskId: 'lumen-plan', subject: 'plan.md', items: list.items }, 'tok'],
			['acme', { taskId: 'lumen-other', subject: 'plan.md', items: list.items }, 'tok'],
			['acme', { taskId: 'lumen-plan', subject: 'plan.md', items: list.items }, 'tok']
		]);

		const fleetHost = pluginHost(entry(), deps);
		expect(await fleetHost.sendFeedback(list)).toEqual({
			ok: false,
			error: 'Name the task the feedback is about.'
		});
	});

	it('has a feedback list summarised only on the captain’s click, and only where the page can', async () => {
		const summarise = vi.fn(async () => ({
			ok: true as const,
			points: [{ text: 'Add a rollback step', points: null, from: [1] }]
		}));
		let clicked = false;
		const deps = {
			status: vi.fn(),
			launch: vi.fn(),
			feedback: vi.fn(),
			summarise,
			clicked: () => clicked,
			token: () => 'tok'
		};
		const host = pluginHost(entry({ slot: 'task.section', taskId: 'lumen-plan' }), deps);
		const list = { subject: 'plan.md', items: [{ text: 'Add a rollback step' }] };
		expect(await host.summariseFeedback(list)).toEqual({
			ok: false,
			error: 'Feedback is summarised only when the captain clicks to.'
		});
		clicked = true;
		expect(await host.summariseFeedback(list)).toEqual({
			ok: true,
			points: [{ text: 'Add a rollback step', points: null, from: [1] }]
		});
		expect(summarise.mock.calls).toEqual([
			['acme', { taskId: 'lumen-plan', subject: 'plan.md', items: list.items }, 'tok']
		]);
		expect(deps.feedback).not.toHaveBeenCalled();
		expect(await pluginHost(entry(), deps).summariseFeedback(list)).toEqual({
			ok: false,
			error: 'Name the task the feedback is about.'
		});
		const without = { ...deps, summarise: undefined };
		expect(
			await pluginHost(
				entry({ slot: 'task.section', taskId: 'lumen-plan' }),
				without
			).summariseFeedback(list)
		).toEqual({ ok: false, error: 'This page cannot summarise feedback.' });
	});

	it('posts a list to its own plugin’s summary address, and says why when there are no points', async () => {
		const { postSummary } = await import('$lib/client/feedback');
		const calls: [string, RequestInit][] = [];
		const answers = [
			Response.json({ points: [{ text: 'One', points: null, from: [1] }] }),
			Response.json({ message: 'Claude Code is not installed.' }, { status: 503 })
		];
		vi.stubGlobal(
			'fetch',
			vi.fn(async (url: string, init: RequestInit) => (calls.push([url, init]), answers.shift()!))
		);
		const body = { taskId: 'lumen-plan', subject: null, items: [{ text: 'One' }] };
		expect(await postSummary('acme', body, 'tok')).toEqual({
			ok: true,
			points: [{ text: 'One', points: null, from: [1] }]
		});
		expect(await postSummary('acme', body, 'tok')).toEqual({
			ok: false,
			error: 'Claude Code is not installed.'
		});
		expect(calls[0][0]).toBe('/api/plugins/acme/feedback/summary');
		expect(new Headers(calls[0][1].headers).get('content-type')).toBe('application/json');
		expect(JSON.parse(String(calls[0][1].body))).toEqual(body);
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => Promise.reject(new Error('down')))
		);
		expect(await postSummary('acme', body, 'tok')).toEqual({
			ok: false,
			error: 'Could not reach the Wheelhouse server.'
		});
		vi.unstubAllGlobals();
	});

	it('posts the list to its own plugin’s feedback address with the session token', async () => {
		const { postFeedback } = await import('$lib/client/feedback');
		const calls: { url: string; init: RequestInit }[] = [];
		vi.stubGlobal(
			'fetch',
			vi.fn(async (url: string, init: RequestInit) => {
				calls.push({ url, init });
				return calls.length === 1
					? new Response('{}', { status: 202 })
					: new Response(JSON.stringify({ message: 'The Acme plugin is off for t.' }), {
							status: 403
						});
			})
		);
		const body = { taskId: 't', subject: null, items: [{ text: 'One' }] };
		expect(await postFeedback('acme', body, 'tok', 'wh-1')).toEqual({ ok: true, pending: true });
		expect(calls[0].url).toBe('/api/plugins/acme/feedback');
		expect(calls[0].init.method).toBe('POST');
		expect(calls[0].init.headers).toMatchObject({
			'idempotency-key': 'wh-1',
			'x-wheelhouse-session': 'tok'
		});
		expect(JSON.parse(String(calls[0].init.body))).toEqual(body);
		expect(await postFeedback('acme', body, 'tok')).toEqual({
			ok: false,
			error: 'The Acme plugin is off for t.'
		});
		vi.unstubAllGlobals();
	});

	it('reports a list Firstmate refused as not sent, with the reason', async () => {
		const { postFeedback } = await import('$lib/client/feedback');
		const answers = [
			new Response(
				JSON.stringify({
					replay: false,
					message: { delivery: 'failed', deliveryDetail: 'fm-inbox.sh exited 1' }
				}),
				{ status: 201 }
			),
			new Response(JSON.stringify({ replay: true, message: { delivery: 'failed' } }), {
				status: 200
			}),
			new Response(JSON.stringify({ replay: false, message: { delivery: 'delivered' } }), {
				status: 201
			}),
			new Response(JSON.stringify({ replay: false, message: { delivery: 'uncertain' } }), {
				status: 202
			})
		];
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => answers.shift())
		);
		const body = { taskId: 't', subject: null, items: [{ text: 'One' }] };
		expect(await postFeedback('acme', body, 'tok')).toEqual({
			ok: false,
			error: 'fm-inbox.sh exited 1'
		});
		expect(await postFeedback('acme', body, 'tok')).toEqual({
			ok: false,
			error: 'Firstmate did not take the list.'
		});
		expect(await postFeedback('acme', body, 'tok')).toEqual({ ok: true, pending: false });
		expect(await postFeedback('acme', body, 'tok')).toEqual({ ok: true, pending: true });
		vi.unstubAllGlobals();
	});

	it('is set on the mounted element, starts its service with the session token, and never shows the token', async () => {
		let made: PluginElement | null = null;
		customElements.define(
			'acme-launcher',
			class extends HTMLElement {
				constructor() {
					super();
					// eslint-disable-next-line @typescript-eslint/no-this-alias
					made = this;
				}
			}
		);
		const posts: { headers: Record<string, string>; body: unknown }[] = [];
		vi.stubGlobal(
			'fetch',
			vi.fn(async (_url: string, init?: RequestInit) => {
				const body = JSON.parse(String(init?.body));
				posts.push({ headers: init?.headers as Record<string, string>, body });
				return new Response(JSON.stringify(view(body.plugin, body.service, body.project)));
			})
		);
		const tab = { document: { write: () => {} }, location: { href: '' }, close: vi.fn() };
		vi.stubGlobal('open', () => tab);
		const c = mount(SlotContent, {
			target: document.body,
			props: { entry: entry({ render: { element: 'acme-launcher' } }) }
		});
		await settle();
		const el = made as unknown as PluginElement;
		expect(el.host?.pluginId).toBe('acme');
		expect(JSON.stringify(el.host)).not.toContain('sekrit');
		expect(Object.values(el.host!).join(' ')).not.toContain('sekrit');

		const v = await el.host!.launch('ui');
		expect(posts).toHaveLength(1);
		expect(posts[0].body).toEqual({ plugin: 'acme', service: 'ui', project: 'docs' });
		expect(Object.values(posts[0].headers)).toContain('sekrit');
		expect(v?.state).toBe('running');
		expect(tab.location.href).toBe('http://127.0.0.1:4400');
		unmount(c);
	});
});
