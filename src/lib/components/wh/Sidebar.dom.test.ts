import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { mainSections } from '$lib/nav';
import Sidebar from './Sidebar.test-fixture.svelte';

const pages = [{ href: '/plugins/improve/proposals', label: 'Improvements' }];
const links = () =>
	[...document.querySelectorAll<HTMLAnchorElement>('aside nav a')].map((a) => ({
		href: a.getAttribute('href'),
		text: a.textContent?.replace(/\s+/g, ' ').trim(),
		current: a.getAttribute('aria-current')
	}));
const collapse = () => document.querySelector<HTMLButtonElement>('aside button')!;

let app: ReturnType<typeof mount> | null = null;
const open = (path = '/', decisionsOpen = 0) => {
	app = mount(Sidebar, {
		target: document.body,
		props: { sections: mainSections(path, pages), decisionsOpen }
	});
	flushSync();
};

beforeEach(() => {
	document.body.innerHTML = '';
	delete document.documentElement.dataset.nav;
	localStorage.clear();
});
afterEach(() => {
	if (app) unmount(app);
	app = null;
});

describe('the left-hand menu', () => {
	it('holds every main section, then the plugin pages, the current one marked', () => {
		open('/tasks/t1');
		expect(links().map((l) => l.text)).toEqual([
			'Firstmate',
			'Harbour',
			'Decisions',
			'Logbook',
			'Improvements'
		]);
		expect(links().filter((l) => l.current === 'page')).toEqual([
			{ href: '/harbour', text: 'Harbour', current: 'page' }
		]);
		expect(links().at(-1)!.href).toBe('/plugins/improve/proposals');
	});

	it('counts the open decisions', () => {
		open('/', 3);
		const d = document.querySelector('aside a[href="/inbox"]')!;
		expect(d.getAttribute('aria-label')).toBe('Decisions, 3 open');
		expect(d.textContent).toContain('3');
	});

	it('folds to its icons and back, remembered in this browser', () => {
		open();
		expect(collapse().getAttribute('aria-label')).toBe('Collapse the menu');
		collapse().click();
		flushSync();
		expect(document.documentElement.dataset.nav).toBe('rail');
		expect(localStorage.getItem('wheelhouse-nav')).toBe('rail');
		expect(collapse().getAttribute('aria-label')).toBe('Expand the menu');
		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', ctrlKey: true, metaKey: true }));
		flushSync();
		expect(document.documentElement.dataset.nav).toBeUndefined();
		expect(localStorage.getItem('wheelhouse-nav')).toBe('full');
	});
});
