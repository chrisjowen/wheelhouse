import { flushSync, mount, tick, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PluginPageView, PluginStatus, PluginsView } from '$lib/plugins/types';

vi.mock('$app/state', () => ({
	page: {
		data: { sessionToken: 'session-token' },
		url: new URL('http://127.0.0.1:4310/settings/plugins')
	}
}));
vi.mock('$app/navigation', () => ({ invalidateAll: async () => {} }));
vi.mock('$lib/client/live.svelte', () => ({
	live: { now: Date.now(), onRestart: () => () => {} }
}));

const { default: Page } = await import('./+page.svelte');

/** GitHub issues, off by default, with one project, lumen. */
const plugin: PluginStatus = {
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
	hostRoutes: [],
	addressRewrites: [],
	enabledByDefault: false,
	enabledWhenFile: null,
	enabledWhenHomeFile: null,
	description: null,
	settings: []
};
const pageView = (
	lumen: { enabled: boolean | null; on: boolean },
	o: Partial<PluginPageView> = {}
): PluginPageView => ({
	schema: 'wheelhouse-plugin.v1',
	plugin,
	enabled: null,
	on: false,
	projects: [{ id: 'lumen', name: 'lumen', defaultOn: false, ...lumen }],
	settings: [],
	configError: null,
	...o
});
const plugins: PluginsView = {
	schema: 'wheelhouse-plugins.v1',
	supported: [1],
	config: { file: null, error: null },
	installed: { dir: null, error: null },
	plugins: [plugin],
	enabled: {},
	suggested: []
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
/** Answers the updates look-up with nothing, and each change with `next`. */
const answering = (next: PluginPageView) => {
	const fetch = vi.fn(async (url: string) =>
		url.endsWith('/config')
			? new Response(JSON.stringify(next), { status: 200 })
			: new Response(JSON.stringify({ plugins: [], checkedAt: null, checking: false, busy: [] }))
	);
	vi.stubGlobal('fetch', fetch);
	return fetch;
};
const changes = (fetch: ReturnType<typeof vi.fn>) =>
	fetch.mock.calls
		.filter(([url]) => String(url).endsWith('/config'))
		.map(([, init]) => JSON.parse((init as RequestInit).body as string));
const show = (v: PluginPageView) => {
	app = mount(Page, {
		target: document.body,
		props: {
			data: { view: plugins, pages: { [plugin.id]: v }, sessionToken: 'session-token' }
		} as never
	});
	flushSync();
};
const row = () => document.querySelector('[data-plugin="github-issues"]')!;
const where = () => row().querySelector('[data-where]')!.textContent?.trim();
const switchState = () => row().querySelector('[role="switch"]')!.getAttribute('aria-checked');
const button = (label: string) =>
	[...row().querySelectorAll('button')].find((b) => b.textContent?.trim() === label);

describe('Settings → Plugins', () => {
	it('never shows Off on the switch of a plugin its row says is on', () => {
		answering(pageView({ enabled: true, on: true }));
		show(pageView({ enabled: true, on: true }));
		expect(where()).toBe('On for 1 project');
		expect(switchState()).toBe('mixed');
		expect(button('Back to the default')).toBeUndefined();
	});

	it('says Off, with the switch off, while it keeps its default', () => {
		answering(pageView({ enabled: null, on: false }));
		show(pageView({ enabled: null, on: false }));
		expect(where()).toBe('Off');
		expect(switchState()).toBe('false');
	});

	it('asks before turning a half-way switch off for every project, then is off everywhere', async () => {
		const fetch = answering(pageView({ enabled: null, on: false }, { enabled: false }));
		show(pageView({ enabled: true, on: true }));
		row().querySelector<HTMLButtonElement>('[role="switch"]')!.click();
		await settle();
		expect(changes(fetch)).toEqual([]);
		expect(row().querySelector('[data-replaces]')!.textContent).toBe(
			'This replaces the choice for lumen.'
		);
		button('Off for every project')!.click();
		await settle();
		expect(changes(fetch)).toEqual([{ enabled: false }]);
		expect(where()).toBe('Off');
		expect(switchState()).toBe('false');
		expect(document.body.textContent).toContain(
			'GitHub issues is off for every project. It applies now, with no restart.'
		);
	});

	it('says Off, with the switch off, while it is on for no project', async () => {
		const fetch = answering(pageView({ enabled: null, on: true }, { enabled: true, on: true }));
		show(pageView({ enabled: false, on: false }, { enabled: true, on: true }));
		expect(where()).toBe('Off');
		expect(switchState()).toBe('false');
		row().querySelector<HTMLButtonElement>('[role="switch"]')!.click();
		await settle();
		expect(changes(fetch)).toEqual([]);
		button('On for every project')!.click();
		await settle();
		expect(changes(fetch)).toEqual([{ enabled: true }]);
		expect(where()).toBe('On');
		expect(switchState()).toBe('true');
	});

	it('goes back to the default from the row once the switch was used', async () => {
		const fetch = answering(pageView({ enabled: null, on: false }));
		show(pageView({ enabled: null, on: true }, { enabled: true, on: true }));
		expect(where()).toBe('On');
		expect(switchState()).toBe('true');
		button('Back to the default')!.click();
		await settle();
		expect(changes(fetch)).toEqual([{ enabled: null }]);
		expect(where()).toBe('Off');
		expect(switchState()).toBe('false');
		expect(button('Back to the default')).toBeUndefined();
		expect(document.body.textContent).toContain(
			'GitHub issues is back to its default: off until you turn it on.'
		);
	});
});
