import { describe, expect, it } from 'vitest';
import {
	findDocRefs,
	isSlug,
	linkPrototype,
	parseRecordKey,
	recordForTask,
	recordHref,
	resolveDocRef,
	slugify,
	tagOf,
	type DocRecord,
	type DocumentsIndex
} from './documents';

describe('findDocRefs', () => {
	it('finds report paths however the home is written, once each', () => {
		expect(
			findDocRefs(
				'See data/wh-x/report.md and /Users/me/Dev/spikes /firstmate/data/wh-y/report.md, again data/wh-x/report.md.'
			)
		).toEqual([
			{ kind: 'task', task: 'wh-x' },
			{ kind: 'task', task: 'wh-y' }
		]);
	});

	it('finds records, short links, library documents and prototypes', () => {
		expect(
			findDocRefs(
				'done · record=lumen/share-proto prototype=prototypes/lumen/share-proto/main, see /records/atlas/crawl@north, /r/wh-z and library/lumen/guides/sharing.md'
			)
		).toEqual([
			{ kind: 'record', key: 'lumen/share-proto' },
			{ kind: 'prototype', id: 'lumen/share-proto/main' },
			{ kind: 'record', key: 'atlas/crawl@north' },
			{ kind: 'task', task: 'wh-z' },
			{ kind: 'library', key: 'lumen/guides/sharing' }
		]);
	});

	it('ignores look-alikes inside words and URLs', () => {
		expect(findDocRefs('https://example.com/r/abc and mydata/x/report.md and records/x')).toEqual(
			[]
		);
	});
});

describe('names', () => {
	it('slugs a title, and falls back when nothing is left', () => {
		expect(slugify('Fleet document store: spec (rev 2)')).toBe('fleet-document-store-spec-rev-2');
		expect(slugify('Café déjà vu')).toBe('cafe-deja-vu');
		expect(slugify('!!!')).toBe('document');
	});

	it('writes tags the way the search box does', () => {
		expect(tagOf('#Dark Mode')).toBe('dark-mode');
		expect(tagOf('  postgres ')).toBe('postgres');
	});

	it('reads a record key, and refuses anything that could leave its folder', () => {
		expect(parseRecordKey('lumen/share@north')).toEqual({
			project: 'lumen',
			task: 'share',
			mate: 'north'
		});
		expect(parseRecordKey('_fleet/spend')).toMatchObject({ project: '_fleet' });
		for (const bad of ['lumen/..', '../x', 'lumen/a/b', 'lumen', 'lumen/x@..'])
			expect(parseRecordKey(bad), bad).toBeNull();
		expect(isSlug('_fleet')).toBe(true);
		expect(isSlug('..')).toBe(false);
		expect(isSlug('Guides')).toBe(false);
	});

	it('builds links that keep the task id', () => {
		expect(recordHref('lumen/share@north')).toBe('/records/lumen/share%40north');
	});
});

describe('linkPrototype', () => {
	it('points links into the prototype folder at the prototype’s page', () => {
		expect(
			linkPrototype(
				'[try it](prototype/index.html), [also](./prototype/) and <a href="prototype/x.html">x</a>; [shot](shots/a.png)',
				'lumen/share/main'
			)
		).toBe(
			'[try it](/prototypes/lumen/share/main), [also](/prototypes/lumen/share/main) and <a href="/prototypes/lumen/share/main">x</a>; [shot](shots/a.png)'
		);
		expect(linkPrototype('[x](prototype/a.html)', undefined)).toBe('[x](prototype/a.html)');
	});
});

describe('resolveDocRef', () => {
	const r = (task: string, mate: string | null = null): DocRecord => ({
		key: `lumen/${task}${mate ? `@${mate}` : ''}`,
		project: 'lumen',
		task,
		mate,
		title: task,
		slug: task,
		kind: 'report',
		at: '2026-11-18T00:00:00Z',
		tags: [],
		path: '',
		bytes: 0,
		prototypes: [],
		promotedTo: null
	});
	const index: DocumentsIndex = {
		records: [r('a'), r('a', 'north')],
		prototypes: [],
		library: [],
		libraryProblem: null,
		generatedAt: ''
	};

	it('finds a task’s record by its id, a second mate’s by <task>@<mate>', () => {
		expect(recordForTask(index, 'a')?.key).toBe('lumen/a');
		expect(recordForTask(index, 'a@north')?.key).toBe('lumen/a@north');
		expect(resolveDocRef(index, { kind: 'task', task: 'b' })).toBeNull();
		expect(resolveDocRef(index, { kind: 'record', key: 'lumen/a@north' })).toMatchObject({
			kind: 'record'
		});
	});
});
