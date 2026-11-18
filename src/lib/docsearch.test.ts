import { describe, expect, it } from 'vitest';
import {
	currentWord,
	filtersMatch,
	filterValues,
	knownToken,
	libraryFacts,
	parseQuery,
	queryText,
	recordFacts,
	search,
	suggestions,
	tokText,
	wordsMatch,
	type Facts
} from './docsearch';
import type { DocRecord, LibraryDoc } from './documents';

const NOW = Date.parse('2026-11-18T12:00:00Z');
const day = (n: number) => new Date(NOW - n * 86_400_000).toISOString();

const rec = (o: Partial<DocRecord>): DocRecord => ({
	key: `${o.project ?? 'lumen'}/${o.task ?? 't'}`,
	project: 'lumen',
	task: 't',
	mate: null,
	title: 'Untitled',
	slug: 'untitled',
	kind: 'report',
	at: day(1),
	tags: [],
	path: 'data/t/report.md',
	bytes: 10,
	prototypes: [],
	promotedTo: null,
	...o
});

const records = [
	rec({
		task: 'share',
		title: 'Share links prototype',
		slug: 'share-links',
		tags: ['sharing', 'privacy'],
		at: day(0.5)
	}),
	rec({
		task: 'pal',
		title: 'Night palette',
		slug: 'night-palette',
		tags: ['dark-mode'],
		at: day(3)
	}),
	rec({
		project: 'tidepool',
		task: 'retry',
		title: 'Retries',
		slug: 'retries',
		kind: 'ship',
		at: day(20)
	}),
	rec({
		project: 'atlas',
		task: 'crawl',
		mate: 'north',
		title: 'Link crawler',
		slug: 'link-crawler',
		tags: ['postgres'],
		at: day(40)
	})
];
const facts = records.map(recordFacts);

describe('parseQuery', () => {
	it('splits words, #tags and key:value filters', () => {
		expect(parseQuery('night #Dark-Mode project:Lumen mate:north', 'records')).toEqual({
			toks: [
				{ k: 'tag', v: 'dark-mode' },
				{ k: 'project', v: 'lumen' },
				{ k: 'mate', v: 'north' }
			],
			words: ['night']
		});
	});

	it('reads #report, #ship and #prototype as a record’s kind, and only on Records', () => {
		expect(parseQuery('#ship #prototype', 'records').toks).toEqual([
			{ k: 'kind', v: 'ship' },
			{ k: 'kind', v: 'prototype' }
		]);
		expect(parseQuery('#ship', 'library').toks).toEqual([{ k: 'tag', v: 'ship' }]);
	});

	it('keeps a key the tab does not know as a word, and skips a bare #', () => {
		expect(parseQuery('folder:lumen/guides http://x # ', 'records')).toEqual({
			toks: [],
			words: ['folder:lumen/guides', 'http://x']
		});
		expect(parseQuery('folder:lumen/guides status:draft', 'library').toks).toEqual([
			{ k: 'folder', v: 'lumen/guides' },
			{ k: 'status', v: 'draft' }
		]);
	});

	it('writes a query back as text', () => {
		const q = parseQuery('palette #dark-mode since:7d', 'records');
		expect(queryText(q)).toBe('#dark-mode since:7d palette');
		expect(tokText({ k: 'kind', v: 'ship' })).toBe('#ship');
	});
});

describe('filtersMatch', () => {
	it('ORs filters on one key and ANDs different keys', () => {
		const lumen = facts[0];
		expect(
			filtersMatch(lumen, parseQuery('project:lumen project:atlas', 'records').toks, NOW)
		).toBe(true);
		expect(filtersMatch(lumen, parseQuery('project:lumen #privacy', 'records').toks, NOW)).toBe(
			true
		);
		expect(filtersMatch(lumen, parseQuery('project:lumen #postgres', 'records').toks, NOW)).toBe(
			false
		);
	});

	it('reads since: as days back from now, and an unknown span as no match', () => {
		const toks = parseQuery('since:7d', 'records').toks;
		expect(facts.map((f) => filtersMatch(f, toks, NOW))).toEqual([true, true, false, false]);
		expect(filtersMatch(facts[0], [{ k: 'since', v: 'soon' }], NOW)).toBe(false);
	});

	it('matches a main-home record as mate:main', () => {
		expect(facts.filter((f) => filtersMatch(f, [{ k: 'mate', v: 'main' }], NOW))).toHaveLength(3);
	});

	it('matches a library folder, or a whole shelf by its prefix', () => {
		const doc: LibraryDoc = {
			key: 'lumen/guides/sharing',
			shelf: 'lumen',
			folder: 'guides',
			slug: 'sharing',
			title: 'Sharing guidelines',
			status: 'draft',
			tags: ['sharing'],
			from: null,
			updated: day(1),
			commits: 2
		};
		const f = libraryFacts(doc);
		expect(filtersMatch(f, [{ k: 'folder', v: 'lumen/guides' }], NOW)).toBe(true);
		expect(filtersMatch(f, [{ k: 'folder', v: 'lumen' }], NOW)).toBe(true);
		expect(filtersMatch(f, [{ k: 'folder', v: 'lumen/guide' }], NOW)).toBe(false);
		expect(filtersMatch(f, [{ k: 'status', v: 'draft' }], NOW)).toBe(true);
	});
});

describe('words', () => {
	it('matches every word in some field, and says why when it was not the title', () => {
		expect(wordsMatch(facts[0], ['share', 'links'])).toEqual({ ok: true, why: null });
		expect(wordsMatch(facts[3], ['postgres'])).toEqual({ ok: true, why: 'tag: postgres' });
		expect(wordsMatch(facts[3], ['north'])).toEqual({ ok: true, why: 'mate: north' });
		expect(wordsMatch(facts[0], ['share', 'nothing'])).toEqual({ ok: false, why: null });
	});

	it('searches items by filters and words together', () => {
		const hits = search(records, recordFacts, parseQuery('#ship retr', 'records'), NOW);
		expect(hits.map((h) => h.item.task)).toEqual(['retry']);
		expect(search(records, recordFacts, parseQuery('', 'records'), NOW)).toHaveLength(4);
	});
});

describe('autocomplete', () => {
	it('offers kinds and tags after #, with how many each would leave', () => {
		const s = suggestions('records', '#p', facts, [], NOW);
		expect(s.map((x) => [x.label, x.count])).toEqual([
			['#prototype', 0],
			['#postgres', 1],
			['#privacy', 1]
		]);
	});

	it('offers a key’s values, minus those already chosen', () => {
		const chosen = [{ k: 'project', v: 'lumen' }];
		const s = suggestions('records', 'project:', facts, chosen, NOW);
		expect(s.map((x) => x.label)).toEqual(['project:atlas', 'project:tidepool']);
		// Counts allow for the chips already there: same key is OR.
		expect(s[0].count).toBe(3);
	});

	it('offers the keys themselves, and values once two letters are typed', () => {
		expect(suggestions('records', '', facts, [], NOW).map((x) => x.label)).toEqual([
			'#',
			'project:',
			'kind:',
			'state:',
			'mate:',
			'since:'
		]);
		expect(suggestions('records', 'no', facts, [], NOW).map((x) => x.label)).toEqual([
			'mate:north'
		]);
		expect(suggestions('library', 'fo', [], [], NOW).map((x) => x.insert)).toEqual(['folder:']);
	});

	it('knows a filter that names a real value from one still being typed', () => {
		const values = filterValues('records', facts);
		expect(knownToken({ k: 'mate', v: 'north' }, values)).toBe(true);
		expect(knownToken({ k: 'mate', v: 'n' }, values)).toBe(false);
		expect(currentWord('project:lumen sha')).toBe('sha');
		expect(currentWord('project:lumen ')).toBe('');
	});

	it('lists each filter’s values, most common first', () => {
		const more: Facts[] = [...facts, recordFacts(rec({ tags: ['privacy'] }))];
		const v = filterValues('records', more);
		expect(v.project[0]).toBe('lumen');
		expect(v.tag[0]).toBe('privacy');
		expect(v.kind).toEqual(['report', 'ship', 'prototype']);
	});
});
