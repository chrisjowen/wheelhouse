import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { mountElement, type PluginElement } from '$lib/plugins/elements';
import type { SlotEntry } from '$lib/plugins/types';
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

afterEach(() => {
	document.body.innerHTML = '';
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
