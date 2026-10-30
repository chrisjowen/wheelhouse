import { describe, expect, it } from 'vitest';
import { mainSections } from './nav';

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

	it('marks a plugin page, not the Logbook', () => {
		const pages = [{ href: '/plugins/improve/proposals', label: 'Improvements' }];
		expect(on('/plugins/improve/proposals', pages)).toEqual(['Improvements']);
	});
});
