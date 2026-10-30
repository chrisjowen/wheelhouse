import { flushSync, mount, tick, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PluginPageView, PluginStatus } from '$lib/plugins/types';

vi.mock('$app/state', () => ({
	page: {
		data: { sessionToken: 'session-token' },
		url: new URL('http://127.0.0.1:4310/settings/plugins/github-issues')
	}
}));
vi.mock('$app/navigation', () => ({ invalidateAll: async () => {} }));

const { default: Page } = await import('./+page.svelte');

const status = (o: Partial<PluginStatus> = {}): PluginStatus => ({
	id: 'github-issues',
	name: 'GitHub issues',
	version: '0.1.0',
	apiVersion: 1,
	state: 'loaded',
	reason: null,
	source: 'builtin',
	repository: null,
	commit: null,
	slots: ['home.card', 'project.tab'],
	enabledByDefault: false,
	enabledWhenFile: null,
	enabledWhenHomeFile: null,
	description: 'Open GitHub issues that match your watch rule.',
	settings: [
		{
			key: 'labels',
			title: 'Labels to watch',
			description: null,
			type: 'list',
			required: false,
			default: ['ready-for-pr']
		},
		{
			key: 'mode',
			title: 'When a new issue turns up',
			description: null,
			type: 'text',
			required: false,
			default: 'list',
			options: [
				{ value: 'list', label: 'Just list it' },
				{ value: 'bell', label: 'Ring the ship’s bell' }
			]
		}
	],
	...o
});
const view = (o: Partial<PluginPageView> = {}): PluginPageView => {
	const plugin = o.plugin ?? status();
	return {
		schema: 'wheelhouse-plugin.v1',
		plugin,
		enabled: null,
		on: false,
		projects: [
			{ id: 'lumen', name: 'lumen', enabled: null, defaultOn: false, on: false },
			{ id: 'atlas', name: 'atlas', enabled: true, defaultOn: false, on: true }
		],
		settings: plugin.settings,
		configError: null,
		...o
	};
};

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
const show = (v: PluginPageView, canRestart = true) => {
	app = mount(Page, { target: document.body, props: { data: { view: v, canRestart } } as never });
	flushSync();
};
const answering = (next: PluginPageView) => {
	const fetch = vi.fn(async () => new Response(JSON.stringify(next), { status: 200 }));
	vi.stubGlobal('fetch', fetch);
	return fetch;
};
const sent = (fetch: ReturnType<typeof vi.fn>, i = 0) => {
	const [url, init] = fetch.mock.calls[i] as unknown as [string, RequestInit];
	expect((init.headers as Record<string, string>)['x-wheelhouse-session']).toBe('session-token');
	return { url, body: JSON.parse(init.body as string) };
};
const text = () => document.body.textContent?.replace(/\s+/g, ' ') ?? '';

describe('Settings → Plugins → one plugin', () => {
	it('says in plain words where it is on, what it adds and that it has settings', () => {
		show(view());
		expect(text()).toContain('By default: off until you turn it on.');
		expect(text()).toContain('lumen · off, as the plugin');
		expect(text()).toContain('atlas · on');
		expect(text()).toContain('A tab beside the Firstmate chat and a tab on each project');
		expect(text()).toContain('Comes with Wheelhouse');
		expect(text()).not.toContain('project.tab');
		const labels = document.querySelector<HTMLInputElement>('input')!;
		expect(labels.value).toBe('ready-for-pr');
		expect(document.querySelector<HTMLSelectElement>('select')!.value).toBe('list');
	});

	it('turns it on for every project, and says it applies with no restart', async () => {
		const lumen = { id: 'lumen', name: 'lumen', enabled: null, defaultOn: false, on: true };
		const fetch = answering(view({ enabled: true, on: true, projects: [lumen] }));
		show(view({ projects: [{ ...lumen, on: false }] }));
		expect(document.querySelector('[role="switch"]')!.getAttribute('aria-checked')).toBe('false');
		document.querySelector<HTMLButtonElement>('[role="switch"]')!.click();
		await settle();
		expect(sent(fetch)).toEqual({
			url: '/api/plugins/github-issues/config',
			body: { enabled: true }
		});
		expect(document.querySelector('[role="switch"]')!.getAttribute('aria-checked')).toBe('true');
		expect(text()).toContain(
			'GitHub issues is on for every project. It applies now, with no restart.'
		);
		expect(text()).toContain('Back to the default');
	});

	it('shows the switch half-way while it differs by project, and asks before turning it on or off', async () => {
		const fetch = answering(view());
		show(view());
		expect(text()).toContain('Every project · On for 1 of 2 projects');
		const sw = document.querySelector<HTMLButtonElement>('[role="switch"]')!;
		expect(sw.getAttribute('aria-checked')).toBe('mixed');
		sw.click();
		flushSync();
		expect(fetch).not.toHaveBeenCalled();
		expect(text()).toContain('This replaces the choice for atlas.');
		const offAll = [...document.querySelectorAll('button')].find(
			(b) => b.textContent?.trim() === 'Off for every project'
		)!;
		offAll.click();
		await settle();
		expect(sent(fetch).body).toEqual({ enabled: false });
	});

	it('turns it on for one project, or lets it follow the plugin again', async () => {
		const fetch = answering(view());
		show(view());
		const radios = [
			...document.querySelectorAll<HTMLButtonElement>('[data-project="lumen"] [role="radio"]')
		];
		expect(radios.map((r) => r.textContent?.trim())).toEqual(['As the plugin', 'On', 'Off']);
		radios[1].click();
		await settle();
		expect(sent(fetch).body).toEqual({ project: 'lumen', enabled: true });
		document
			.querySelectorAll<HTMLButtonElement>('[data-project="atlas"] [role="radio"]')[0]
			.click();
		await settle();
		expect(sent(fetch, 1).body).toEqual({ project: 'atlas', enabled: null });
		expect(text()).toContain('atlas follows the plugin again.');
	});

	it('saves its settings from the shared form, only once something changed', async () => {
		const fetch = answering(view());
		show(view());
		const save = [...document.querySelectorAll('button')].find(
			(b) => b.textContent?.trim() === 'Save settings'
		)!;
		expect(save.disabled).toBe(true);
		const labels = document.querySelector<HTMLInputElement>('input')!;
		labels.value = 'bug, ready-for-pr';
		labels.dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
		expect(text()).toContain('Not saved yet');
		expect(save.disabled).toBe(false);
		save.click();
		await settle();
		expect(sent(fetch).body).toEqual({
			settings: { labels: 'bug, ready-for-pr', mode: 'list' }
		});
		expect(text()).toContain(
			'Settings saved. GitHub issues uses them from its next look, with no restart.'
		);
	});

	it('offers to load an installed plugin that is turned off, saying it restarts Wheelhouse', () => {
		show(
			view({ plugin: status({ state: 'disabled', source: 'installed', repository: 'acme/x' }) })
		);
		expect(text()).toContain('Not loaded');
		expect(text()).toContain('loading it restarts Wheelhouse');
		expect(
			[...document.querySelectorAll('button')].some((b) =>
				b.textContent?.includes('Load and restart')
			)
		).toBe(true);
		expect(text()).toContain('acme/x');
	});

	it('changes nothing while the plugins file is not valid', () => {
		show(
			view({
				configError:
					'Wheelhouse’s plugins file is not valid, so every plugin keeps its default and nothing can be changed here until it is fixed.'
			})
		);
		expect(text()).toContain('plugins file is not valid');
		expect(document.querySelector<HTMLButtonElement>('[role="switch"]')!.disabled).toBe(true);
	});
});
