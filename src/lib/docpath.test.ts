import { describe, expect, it } from 'vitest';
import {
	docHref,
	findDocPaths,
	linkedDocPath,
	normalizePath,
	resolveInDoc,
	splitDocPaths
} from './docpath';

const paths = (text: string) => findDocPaths(text).map((m) => m.path);

describe('findDocPaths', () => {
	it('finds a relative report path in a reply', () => {
		expect(paths('The design is in data/wh-gateway-design/report.md, have a look.')).toEqual([
			'data/wh-gateway-design/report.md'
		]);
	});

	it('finds absolute paths, including a home with a space in it', () => {
		expect(
			paths('done: report at /Users/me/Dev/spikes /firstmate/data/wh-x/report.md; ready')
		).toEqual(['/Users/me/Dev/spikes /firstmate/data/wh-x/report.md']);
		expect(paths('file=/tmp/fm/data/a/notes.markdown')).toEqual(['/tmp/fm/data/a/notes.markdown']);
	});

	it('finds paths inside backticks, brackets, quotes and emphasis', () => {
		expect(paths('see `data/a/report.md` (or "docs/plan.md") and **docs/b.mdx**')).toEqual([
			'data/a/report.md',
			'docs/plan.md',
			'docs/b.mdx'
		]);
	});

	it('keeps two absolute paths apart', () => {
		expect(paths('/a/b/one.md /a/c/two.md')).toEqual(['/a/b/one.md', '/a/c/two.md']);
	});

	it('leaves trailing punctuation out', () => {
		expect(paths('Read data/a/report.md. Then data/b/report.md: done')).toEqual([
			'data/a/report.md',
			'data/b/report.md'
		]);
	});

	it('ignores URLs, bare names, other extensions and longer names', () => {
		expect(paths('https://github.com/o/r/blob/main/docs/guide.md')).toEqual([]);
		expect(paths('I updated README.md')).toEqual([]);
		expect(paths('data/a/report.txt and src/a.ts')).toEqual([]);
		expect(paths('data/a/report.md.bak and data/a/report.mdown')).toEqual([]);
		expect(paths('~/notes/today.md')).toEqual([]);
	});

	it('splits text into runs around the paths', () => {
		expect(splitDocPaths('Report: data/a/report.md (draft)')).toEqual([
			{ text: 'Report: ', path: null },
			{ text: 'data/a/report.md', path: 'data/a/report.md' },
			{ text: ' (draft)', path: null }
		]);
		expect(splitDocPaths('nothing here')).toEqual([{ text: 'nothing here', path: null }]);
	});
});

describe('links', () => {
	it('links to the reader with the path encoded', () => {
		expect(docHref('/a b/c.md')).toBe('/files?path=%2Fa%20b%2Fc.md');
	});

	it('takes a Markdown link to a file, not to a web page', () => {
		expect(linkedDocPath('data/a/report.md')).toBe('data/a/report.md');
		expect(linkedDocPath('/Users/me/spikes%20/fm/data/a.md#top')).toBe(
			'/Users/me/spikes /fm/data/a.md'
		);
		expect(linkedDocPath('https://example.com/a.md')).toBe(null);
		expect(linkedDocPath('#section')).toBe(null);
		expect(linkedDocPath('/tasks/wh-1')).toBe(null);
	});

	it('normalises dot segments without climbing above the root', () => {
		expect(normalizePath('/a/b/../c/./d.md')).toBe('/a/c/d.md');
		expect(normalizePath('/../../etc/passwd')).toBe('/etc/passwd');
		expect(normalizePath('a//b/')).toBe('a/b');
	});
});

describe('resolveInDoc', () => {
	const doc = '/home/fm/data/x/report.md';

	it('resolves relative links and images against the document’s folder', () => {
		expect(resolveInDoc('plan.md#risks', doc, 'a')).toBe(
			`${docHref('/home/fm/data/x/plan.md')}#risks`
		);
		expect(resolveInDoc('../y/report.md', doc, 'a')).toBe(docHref('/home/fm/data/y/report.md'));
		expect(resolveInDoc('shots/one%20two.png', doc, 'img')).toBe(
			'/api/files?path=%2Fhome%2Ffm%2Fdata%2Fx%2Fshots%2Fone%20two.png'
		);
		expect(resolveInDoc('diagram.svg', doc, 'a')).toBe(
			'/api/files?path=%2Fhome%2Ffm%2Fdata%2Fx%2Fdiagram.svg'
		);
		expect(resolveInDoc('/srv/repo/README.md', doc, 'a')).toBe(docHref('/srv/repo/README.md'));
	});

	it('keeps fragments and web links, and drops other schemes', () => {
		expect(resolveInDoc('#risks', doc, 'a')).toBe('#risks');
		expect(resolveInDoc('https://example.com', doc, 'a')).toBe('https://example.com');
		expect(resolveInDoc('mailto:a@b.c', doc, 'a')).toBe('mailto:a@b.c');
		expect(resolveInDoc('javascript:alert(1)', doc, 'a')).toBe(null);
		expect(resolveInDoc(' JavaScript:alert(1)', doc, 'a')).toBe(null);
		expect(resolveInDoc('file:///etc/passwd', doc, 'a')).toBe(null);
		expect(resolveInDoc('//evil.example/x.png', doc, 'img')).toBe(null);
		expect(resolveInDoc('data:image/png;base64,AA', doc, 'img')).toBe('data:image/png;base64,AA');
		expect(resolveInDoc('data:image/svg+xml;base64,AA', doc, 'img')).toBe(null);
		expect(resolveInDoc('', doc, 'img')).toBe(null);
	});
});
