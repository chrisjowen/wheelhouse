import { describe, expect, it } from 'vitest';
import { harbourHref, LOGBOOK_ROW, mainSections } from './nav';

const on = (path: string, pages: { href: string; label: string }[] = []) =>
	mainSections(path, pages)
		.filter((s) => s.on)
		.map((s) => s.label);

describe('the main sections', () => {
	it('lists the built-in sections in order, then the plugin pages', () => {
		const pages = [{ href: '/plugins/improve/proposals', label: 'Improvements' }];
		expect(mainSections('/', pages).map((s) => s.label)).toEqual([
			'Firstmate',
			'Harbour',
			'Projects',
			'Decisions',
			'Logbook',
			'Improvements'
		]);
		expect(mainSections('/', pages).at(-1)!.key).toBeNull();
	});

	it('marks the section the page belongs to', () => {
		expect(on('/')).toEqual(['Firstmate']);
		expect(on('/harbour')).toEqual(['Harbour']);
		expect(on('/tasks/t1/review')).toEqual(['Harbour']);
		expect(on('/projects')).toEqual(['Projects']);
		expect(on('/projects/lumen/passage/edit')).toEqual(['Projects']);
		expect(on('/inbox')).toEqual(['Decisions']);
		for (const p of ['/headroom', '/time', '/decisions']) expect(on(p)).toEqual(['Logbook']);
		// Settings, Plugins among them, sits behind the header's gear, not in the menu.
		expect(on('/settings/plugins/github-issues')).toEqual([]);
	});

	it('opens Settings → Plugins from the Logbook’s row too', () => {
		expect(LOGBOOK_ROW.map((p) => p.label)).toEqual([
			'Headroom',
			'Where time went',
			'Decided for you',
			'Plugins'
		]);
		expect(LOGBOOK_ROW.at(-1)!.href).toBe('/settings/plugins');
	});

	it('marks a plugin page, not the Logbook', () => {
		const pages = [{ href: '/plugins/improve/proposals', label: 'Improvements' }];
		expect(on('/plugins/improve/proposals', pages)).toEqual(['Improvements']);
	});
});

describe('the way back to Harbour', () => {
	it('opens the Harbour board for the task’s project, never the home page', () => {
		expect(harbourHref('lumen')).toBe('/harbour?project=lumen');
		expect(harbourHref('ai innovations/chat')).toBe('/harbour?project=ai%20innovations%2Fchat');
		expect(harbourHref()).toBe('/harbour');
		expect(harbourHref(null)).toBe('/harbour');
	});
});
