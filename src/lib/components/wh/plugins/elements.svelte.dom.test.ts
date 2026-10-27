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
		const host = pluginHost(entry(), { status, launch, token: () => 'tok' });
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
