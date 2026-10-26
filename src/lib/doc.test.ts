import { describe, expect, it } from 'vitest';
import { outline, slug } from './doc';

describe('slug', () => {
	it('joins words with hyphens in lower case', () => {
		expect(slug('Share links: how they expire')).toBe('share-links-how-they-expire');
	});
	it('drops accents and keeps letters from any script', () => {
		expect(slug('Café menü')).toBe('cafe-menu');
		expect(slug('写真の共有')).toBe('写真の共有');
	});
	it('falls back when nothing is left', () => {
		expect(slug('!!!')).toBe('section');
	});
});

describe('outline', () => {
	it('gives repeated headings distinct ids', () => {
		const o = outline([
			{ text: 'Context', level: 2 },
			{ text: 'Notes', level: 3 },
			{ text: 'Notes', level: 3 }
		]);
		expect(o.map((e) => e.id)).toEqual(['doc-context', 'doc-notes', 'doc-notes-2']);
		expect(o[1].level).toBe(3);
	});
	it('avoids ids the page already uses', () => {
		expect(outline([{ text: 'Main', level: 2 }], ['doc-main'])[0].id).toBe('doc-main-2');
	});
});
