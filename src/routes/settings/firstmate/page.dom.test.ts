import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
	FirstmateProject,
	FirstmateSetting,
	FirstmateSettingsView
} from '$lib/server/firstmate/settings';

vi.mock('$app/state', () => ({
	page: {
		data: {},
		url: new URL('http://127.0.0.1:4310/settings/firstmate')
	}
}));

const { default: Page } = await import('./+page.svelte');

const setting = (o: Partial<FirstmateSetting> = {}): FirstmateSetting => ({
	id: 'tools',
	topic: 'workers',
	label: 'Tools hidden from workers',
	meaning: 'Tools new workers are not allowed to use',
	value: '2 tools hidden',
	sub: null,
	tag: 'Ask Firstmate',
	share: 'home',
	shareText: 'This home only.',
	affects: 'Every new worker or relaunch.',
	history: ['File last changed today. Who changed it is not recorded.'],
	details: [{ title: 'Hidden tools', rows: [{ label: 'Tool', value: 'example-tool' }] }],
	technical: {
		file: 'config/crew-exclude-tools',
		reader: 'bin/fm-spawn.sh',
		documentation: 'docs/configuration.md · Worker tool exclusions'
	},
	...o
});

const project: FirstmateProject = {
	name: 'sample-app',
	mode: 'Always fully checked',
	modeShort: 'Always fully checked',
	autoMerge: false,
	capacity: null,
	meaning: 'How this project is checked.',
	shareText: 'This home’s project entry.',
	history: ['No change history is recorded.'],
	technical: {
		file: 'data/projects.md',
		reader: 'parseProjectsRegistry',
		documentation: 'docs/configuration.md · Project registry'
	}
};

const view = (settings: FirstmateSetting[] = [setting()]): FirstmateSettingsView => ({
	available: true,
	reason: null,
	readAt: '2026-11-15T00:00:00.000Z',
	projectCount: 1,
	mateCount: 0,
	dispatchRuleCount: 0,
	settings,
	projects: [project],
	mates: [],
	startupBudget: { budget: 100, used: 120, overBy: 20 }
});

let app: ReturnType<typeof mount> | null = null;
afterEach(() => {
	if (app) unmount(app);
	app = null;
	document.body.innerHTML = '';
});

const button = (label: string) =>
	[...document.querySelectorAll('button')].find((item) => item.textContent?.includes(label));

describe('Settings → Firstmate', () => {
	it('shows the read-only settings topics and real startup-budget notice', () => {
		app = mount(Page, {
			target: document.body,
			props: { data: { view: view(), canAsk: true } } as never
		});
		flushSync();

		expect(document.body.textContent).toContain('Workers & instructions');
		expect(document.body.textContent).toContain('Safety & accounts');
		expect(document.body.textContent).toContain('Your startup notes are over budget.');
		expect(document.body.textContent).toContain('2 tools hidden');
		expect(document.querySelector('a[aria-current="page"]')?.textContent).toContain('Firstmate');
		expect(document.body.textContent).toContain('read-only');
	});

	it('opens the detail panel with a collapsed technical section and a prefilled chat link', () => {
		app = mount(Page, {
			target: document.body,
			props: { data: { view: view(), canAsk: true } } as never
		});
		flushSync();

		button('Tools hidden from workers')?.click();
		flushSync();

		expect(document.querySelector('[role="dialog"]')).toBeTruthy();
		expect(document.body.textContent).toContain('What it changes');
		expect(document.body.textContent).toContain('Second mates');
		expect(document.querySelector('details')?.open).toBe(false);
		expect(document.querySelector('a[href^="/?draft="]')?.getAttribute('href')).toBe(
			'/?draft=Please%20review%20how%20tools%20hidden%20from%20workers%20is%20configured.'
		);
	});

	it('omits the chat action when Firstmate messaging is unavailable', () => {
		app = mount(Page, {
			target: document.body,
			props: { data: { view: view(), canAsk: false } } as never
		});
		flushSync();
		button('Tools hidden from workers')?.click();
		flushSync();

		expect(document.querySelector('a[href^="/?draft="]')).toBeNull();
	});

	it('opens a project in the same read-only detail panel', () => {
		app = mount(Page, {
			target: document.body,
			props: { data: { view: view([]), canAsk: true } } as never
		});
		flushSync();
		button('sample-app')?.click();
		flushSync();

		expect(document.querySelector('[role="dialog"]')?.textContent).toContain('How work is checked');
		expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
			'Always fully checked'
		);
	});
});
