import { flushSync, mount, tick, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MarketplacePlugin, MarketplaceView } from '$lib/plugins/marketplace';

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

const view = (o: Partial<MarketplaceView> = {}): MarketplaceView => ({
	schema: 'wheelhouse-marketplace.v1',
	config: { file: '/cfg/plugin-registries.json', error: null },
	registries: [
		{
			source: 'chrisjowen/wheelhouse-plugins',
			url: 'https://raw.githubusercontent.com/chrisjowen/wheelhouse-plugins/HEAD/wheelhouse-registry.json',
			official: true,
			name: 'Wheelhouse plugins',
			description: null,
			error: null,
			unpublished: false,
			skipped: [],
			count: 3
		}
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
function answering(v: MarketplaceView, lookUp: Response = new Response('{}', { status: 500 })) {
	const fetch = vi.fn(async (url: string) => {
		if (url.startsWith('/api/plugins/marketplace')) return new Response(JSON.stringify(v));
		if (url === '/api/plugins/inspect') return lookUp;
		return new Response(JSON.stringify({ plugins: [], checkedAt: null, busy: [] }));
	});
	vi.stubGlobal('fetch', fetch);
	return fetch;
}

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
		v.registries.push({
			source: 'acme/plugins',
			url: 'https://raw.githubusercontent.com/acme/plugins/HEAD/wheelhouse-registry.json',
			official: false,
			name: null,
			description: null,
			error: 'It is not valid JSON: Unexpected end of JSON input',
			unpublished: false,
			skipped: [],
			count: 0
		});
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
});
