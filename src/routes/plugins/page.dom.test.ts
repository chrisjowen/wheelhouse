import { flushSync, mount, tick, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MarketplacePlugin, MarketplaceView, RegistryView } from '$lib/plugins/marketplace';

vi.mock('$app/state', () => ({
	page: {
		data: { sessionToken: 'session-token' },
		url: new URL('http://127.0.0.1:4310/plugins')
	}
}));
vi.mock('$app/navigation', () => ({ invalidateAll: async () => {} }));
vi.mock('$lib/client/live.svelte', () => ({
	live: { now: Date.now(), onRestart: () => () => {} }
}));

const { default: Page } = await import('./+page.svelte');

const plugin = (name: string, o: Partial<MarketplacePlugin> = {}): MarketplacePlugin => ({
	name,
	displayName: name,
	description: `The ${name} plugin.`,
	icon: null,
	repository: `acme/${name}`,
	ref: null,
	author: null,
	homepage: null,
	keywords: [],
	registry: 'chrisjowen/wheelhouse-plugins',
	...o
});

const registry = (o: Partial<RegistryView> = {}): RegistryView => ({
	id: 'acme--plugins-1111111111',
	source: 'acme/plugins',
	url: 'https://github.com/acme/plugins/blob/HEAD/wheelhouse-registry.json',
	official: false,
	name: null,
	description: null,
	error: null,
	unpublished: false,
	skipped: [],
	count: 0,
	syncedAt: new Date().toISOString(),
	syncError: null,
	...o
});

const view = (o: Partial<MarketplaceView> = {}): MarketplaceView => ({
	schema: 'wheelhouse-marketplace.v1',
	config: { file: '/cfg/plugin-registries.json', error: null },
	registries: [
		registry({
			id: 'chrisjowen--wheelhouse-plugins-0000000000',
			source: 'chrisjowen/wheelhouse-plugins',
			url: 'https://github.com/chrisjowen/wheelhouse-plugins/blob/HEAD/wheelhouse-registry.json',
			official: true,
			name: 'Wheelhouse plugins',
			count: 3
		})
	],
	plugins: [
		plugin('docket', { displayName: 'Docket', description: 'A chart of a project’s docket.' }),
		plugin('board', { displayName: 'Board', description: 'Your GitHub project board.' })
	],
	installed: 1,
	fetchedAt: new Date().toISOString(),
	...o
});

let app: ReturnType<typeof mount> | null = null;
afterEach(() => {
	if (app) unmount(app);
	app = null;
	document.body.innerHTML = '';
	vi.unstubAllGlobals();
});
const settle = async () => {
	for (let i = 0; i < 5; i++) {
		await new Promise((r) => setTimeout(r, 0));
		await tick();
	}
	flushSync();
};

/** Answers the marketplace with `v`, the look-up with `lookUp`, and the updates check with nothing. */
function answering(
	v: MarketplaceView,
	lookUp: Response = new Response('{}', { status: 500 }),
	changed: (url: string) => Response = () => new Response('{}', { status: 500 })
) {
	const fetch = vi.fn(async (url: string) => {
		if (url === '/api/plugins/marketplace/registries') return changed(url);
		if (url.startsWith('/api/plugins/marketplace')) return new Response(JSON.stringify(v));
		if (url === '/api/plugins/inspect') return lookUp;
		return new Response(JSON.stringify({ plugins: [], checkedAt: null, busy: [] }));
	});
	vi.stubGlobal('fetch', fetch);
	return fetch;
}

const button = (text: string) =>
	[...document.querySelectorAll<HTMLButtonElement>('button')].find(
		(b) => b.textContent?.trim() === text
	)!;
const rows = () =>
	[...document.querySelectorAll<HTMLElement>('[data-plugin]')].map((e) => e.dataset.plugin);
const type = (text: string) => {
	const input = document.querySelector<HTMLInputElement>('input[type=search]')!;
	input.value = text;
	input.dispatchEvent(new Event('input', { bubbles: true }));
	flushSync();
};

describe('the Plugins page', () => {
	it('lists the plugins not installed, each with Install, and says how many are installed', async () => {
		answering(view());
		app = mount(Page, { target: document.body });
		await settle();
		expect(rows()).toEqual(['docket', 'board']);
		expect(
			[...document.querySelectorAll('button')].filter((b) => b.textContent?.trim() === 'Install')
		).toHaveLength(2);
		expect(document.body.textContent).toMatch(/1\s+plugin is not shown because\s+it is installed/);
	});

	it('filters the results as you type, and says when nothing matches', async () => {
		answering(view());
		app = mount(Page, { target: document.body });
		await settle();
		type('github');
		expect(rows()).toEqual(['board']);
		type('nothing like it');
		expect(rows()).toEqual([]);
		expect(document.body.textContent).toContain('No plugins match “nothing like it”.');
	});

	it('says which registry could not be read, and still shows the others', async () => {
		const v = view();
		v.registries.push(
			registry({ error: 'It is not valid JSON: Unexpected end of JSON input', syncedAt: null })
		);
		answering(v);
		app = mount(Page, { target: document.body });
		await settle();
		const alert = document.querySelector('[data-registry-error="acme/plugins"]');
		expect(alert?.textContent).toMatch(/acme\/plugins\s+could not be read\. It is not valid JSON/);
		expect(rows()).toEqual(['docket', 'board']);
	});

	it('looks a plugin up from its row and shows why when it cannot', async () => {
		const fetch = answering(
			view(),
			new Response(JSON.stringify({ message: 'Could not fetch acme/board.' }), { status: 422 })
		);
		app = mount(Page, { target: document.body });
		await settle();
		document.querySelector<HTMLButtonElement>('button[aria-label="Install Board"]')!.click();
		await settle();
		const inspect = fetch.mock.calls.find(([u]) => u === '/api/plugins/inspect') as unknown as [
			string,
			RequestInit
		];
		expect(JSON.parse(String(inspect[1].body))).toEqual({ repo: 'acme/board', ref: null });
		expect(document.querySelector('[data-plugin=board] [role=alert]')?.textContent).toBe(
			'Could not fetch acme/board.'
		);
	});

	it('says when every listed plugin is installed already', async () => {
		answering(view({ plugins: [], installed: 3 }));
		app = mount(Page, { target: document.body });
		await settle();
		expect(document.body.textContent).toContain(
			'Every plugin in the registries is installed already.'
		);
	});

	it('shows a missing official registry as not published yet, not as a failure', async () => {
		const v = view({ plugins: [], installed: 0 });
		v.registries[0] = { ...v.registries[0], name: null, count: 0, unpublished: true };
		answering(v);
		app = mount(Page, { target: document.body });
		await settle();
		expect(document.querySelector('[role=alert]')).toBeNull();
		expect(
			document.querySelector('[data-registry-unpublished="chrisjowen/wheelhouse-plugins"]')
				?.textContent
		).toMatch(
			/official plugin registry\s+chrisjowen\/wheelhouse-plugins\s+has not been published yet/
		);
		expect(document.body.textContent).not.toContain('No registry could be read');
		expect(document.body.textContent).toContain('There are no plugins to show yet.');
	});

	it('still shows the official registry as failed when it answers something else', async () => {
		const v = view({ plugins: [], installed: 0 });
		v.registries[0] = { ...v.registries[0], name: null, count: 0, error: 'It answered 500.' };
		answering(v);
		app = mount(Page, { target: document.body });
		await settle();
		expect(
			document.querySelector('[data-registry-error="chrisjowen/wheelhouse-plugins"]')?.textContent
		).toMatch(
			/The official registry\s+chrisjowen\/wheelhouse-plugins\s+could not be read\. It answered 500/
		);
		expect(document.querySelector('[data-registry-unpublished]')).toBeNull();
		expect(document.body.textContent).toContain('No registry could be read');
	});

	it('says which registry each plugin is from', async () => {
		const v = view();
		v.registries.push(registry({ name: 'Acme plugins', count: 1 }));
		v.plugins.push(plugin('lift', { registry: 'acme/plugins' }));
		answering(v);
		app = mount(Page, { target: document.body });
		await settle();
		const from = (name: string) =>
			document.querySelector(`[data-plugin=${name}] [data-plugin-source]`)?.textContent?.trim();
		expect(from('docket')).toBe('from Wheelhouse plugins');
		expect(from('lift')).toBe('from Acme plugins');
	});

	it('lists the sources with when each was synced and why a resync failed', async () => {
		const v = view();
		v.registries.push(
			registry({
				name: 'Acme plugins',
				count: 1,
				syncedAt: new Date(Date.now() - 2 * 3600_000).toISOString(),
				syncError: 'It could not be fetched: Could not resolve host: github.com.'
			})
		);
		answering(v);
		app = mount(Page, { target: document.body });
		await settle();
		expect(document.querySelector('[aria-label="Plugin sources"]')).toBeNull();
		button('Sources (2)').click();
		flushSync();
		const rows = [...document.querySelectorAll<HTMLElement>('[data-registry]')];
		expect(rows.map((r) => r.dataset.registry)).toEqual([
			'chrisjowen/wheelhouse-plugins',
			'acme/plugins'
		]);
		expect(rows[0].textContent).toContain('Official');
		expect(rows[0].querySelector('[data-registry-synced]')?.textContent).toMatch(
			/Synced .* 3 plugins/
		);
		expect(rows[1].querySelector('[data-registry-sync-error]')?.textContent).toMatch(
			/Could not resync: It could not be fetched: Could not resolve host/
		);
	});

	it('adds a registry from the sources, and shows why one is refused', async () => {
		const added = view();
		added.registries.push(registry({ name: 'Acme plugins', count: 1 }));
		let answer = new Response(JSON.stringify({ message: 'gitlab.com is not GitHub.' }), {
			status: 400
		});
		const fetch = answering(view(), undefined, () => answer);
		app = mount(Page, { target: document.body });
		await settle();
		button('Sources (1)').click();
		flushSync();
		const input = document.querySelector<HTMLInputElement>(
			'input[aria-label="GitHub repository of a registry"]'
		)!;
		input.value = 'https://gitlab.com/acme/plugins';
		input.dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
		input.form!.requestSubmit();
		await settle();
		expect(document.querySelector('[aria-label="Plugin sources"] [role=alert]')?.textContent).toBe(
			'gitlab.com is not GitHub.'
		);
		answer = new Response(JSON.stringify(added));
		input.value = 'acme/plugins';
		input.dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
		input.form!.requestSubmit();
		await settle();
		const post = fetch.mock.calls.filter(
			([u]) => u === '/api/plugins/marketplace/registries'
		) as unknown as [string, RequestInit][];
		expect(post.map(([, i]) => JSON.parse(String(i.body)))).toEqual([
			{ add: 'https://gitlab.com/acme/plugins' },
			{ add: 'acme/plugins' }
		]);
		expect((post[1][1].headers as Record<string, string>)['x-wheelhouse-session']).toBe(
			'session-token'
		);
		expect(
			[...document.querySelectorAll<HTMLElement>('[data-registry]')].map((r) => r.dataset.registry)
		).toEqual(['chrisjowen/wheelhouse-plugins', 'acme/plugins']);
		expect(input.value).toBe('');
	});

	it('removes a registry after asking, and offers the official one back', async () => {
		const v = view();
		v.registries.push(registry({ name: 'Acme plugins', count: 1 }));
		const fetch = answering(
			v,
			undefined,
			() =>
				new Response(JSON.stringify(view({ registries: [registry({ count: 1 })], plugins: [] })))
		);
		app = mount(Page, { target: document.body });
		await settle();
		button('Sources (2)').click();
		flushSync();
		document
			.querySelector<HTMLButtonElement>(
				'button[aria-label="Remove chrisjowen/wheelhouse-plugins"]'
			)!
			.click();
		flushSync();
		expect(fetch.mock.calls.some(([u]) => u === '/api/plugins/marketplace/registries')).toBe(false);
		button('Remove').click();
		await settle();
		const post = fetch.mock.calls.find(
			([u]) => u === '/api/plugins/marketplace/registries'
		) as unknown as [string, RequestInit];
		expect(JSON.parse(String(post[1].body))).toEqual({
			remove: 'chrisjowen--wheelhouse-plugins-0000000000'
		});
		expect(
			[...document.querySelectorAll<HTMLElement>('[data-registry]')].map((r) => r.dataset.registry)
		).toEqual(['acme/plugins']);
		expect(button('Add the official registry')).toBeTruthy();
	});

	it('resyncs every registry on Resync', async () => {
		const fetch = answering(view());
		app = mount(Page, { target: document.body });
		await settle();
		button('Resync').click();
		await settle();
		expect(fetch.mock.calls.map(([u]) => u)).toContain('/api/plugins/marketplace?refresh=1');
	});
});
