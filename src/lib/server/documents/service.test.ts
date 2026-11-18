import { mkdir, mkdtemp, realpath, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FleetView } from '$lib/types';
import { linkTargets } from './records';
import { DocumentsService } from './service';

let tmp: string;
let home: string;
let outside: string;
let docs: DocumentsService;
const answering = new Set<string>();

async function put(rel: string, text: string, when?: Date) {
	const file = path.join(home, rel);
	await mkdir(path.dirname(file), { recursive: true });
	await writeFile(file, text);
	if (when) await utimes(file, when, when);
}

beforeAll(async () => {
	tmp = await realpath(await mkdtemp(path.join(os.tmpdir(), 'wh-documents-')));
	home = path.join(tmp, 'spikes ', 'firstmate');
	outside = path.join(tmp, 'elsewhere');
	await mkdir(path.join(home, 'state'), { recursive: true });
	await mkdir(outside, { recursive: true });
	await writeFile(path.join(outside, 'secret.png'), 'secret');
	await put(
		'data/backlog.md',
		'- [ ] wh-live - Wheelhouse: live thing (repo: wheelhouse) (kind: scout) (since 2026-11-18)\n'
	);
	await put(
		'data/done-archive.md',
		[
			'- [x] wh-pal - Palette scout data/wh-pal/report.md (repo: wheelhouse) (kind: scout) (reported 2026-11-10)',
			'- [x] dk-ship - Ingest retries (repo: docket) (kind: ship) (landed 2026-11-12)',
			'- [x] no-head - Backlog title wins data/no-head/report.md (repo: docket) (kind: scout) (reported 2026-11-01)'
		].join('\n')
	);
	await put(
		'data/wh-pal/report.md',
		'---\ntags: [palette, Search UI]\n---\n\n# Command palette: flow\n\n![open](shots/open.png) [poster](poster.html) [try it](prototype/index.html) [secret](../../../elsewhere/secret.png) [web](https://example.com) [missing](gone.png) [log](run.log)\n',
		new Date('2026-11-10T10:00:00Z')
	);
	await put('data/wh-pal/shots/open.png', 'png');
	await put('data/wh-pal/poster.html', '<script>alert(1)</script>');
	await put('data/wh-pal/notes.txt', 'not linked');
	await put('data/wh-pal/prototype/index.html', '<h1>live</h1>');
	await put('data/wh-pal/prototype/prototype.json', '{"title":"Palette: clickable"}');
	await put(
		'state/wh-pal.status',
		'working [at=1]: preview http://127.0.0.1:4471/\ndone [at=2]: reported\n'
	);
	await put(
		'data/dk-ship/report.md',
		'# Ingest retries: what landed\n',
		new Date('2026-11-12T10:00:00Z')
	);
	await put('data/no-head/report.md', 'Just text, no heading.\n', new Date('2026-11-01T10:00:00Z'));
	await put('data/proto-only/prototype/index.html', '<p>x</p>');
	await put('data/brief-only/brief.md', '# A brief is not a report\n');
	await put(
		'data/remote-secondmates/north/data/dk-schema/report.md',
		'# Schema migration options\n'
	);
	await symlink(outside, path.join(home, 'data', 'wh-pal', 'linked'));
	await put('data/wh-pal/report2.md', 'unused');
	const fleet = {
		tasks: [{ id: 'dk-schema@north', title: 'docket: schema', projectId: 'docket', kind: 'scout' }],
		secondMates: []
	} as unknown as FleetView;
	docs = new DocumentsService({
		home,
		library: null,
		libraryProblem: 'No library in this test.',
		fleet: () => fleet,
		answers: async (url) => answering.has(url)
	});
});

afterAll(async () => {
	await rm(tmp, { recursive: true, force: true });
});

describe('the index', () => {
	it('lists each report by its title, under its backlog project, newest first', async () => {
		const index = await docs.index();
		expect(index.records.map((r) => [r.key, r.title, r.kind])).toEqual([
			['docket/dk-schema@north', 'Schema migration options', 'report'],
			['docket/dk-ship', 'Ingest retries: what landed', 'ship'],
			['wheelhouse/wh-pal', 'Command palette: flow', 'report'],
			['docket/no-head', 'Backlog title wins', 'report']
		]);
		const pal = index.records.find((r) => r.task === 'wh-pal')!;
		expect(pal).toMatchObject({
			slug: 'command-palette-flow',
			tags: ['palette', 'search-ui'],
			path: 'data/wh-pal/report.md',
			prototypes: ['wheelhouse/wh-pal/main'],
			mate: null
		});
		expect(index.libraryProblem).toBe('No library in this test.');
	});

	it('reads a second mate’s report from the copy this home keeps, with the fleet’s project', async () => {
		const r = (await docs.index()).records.find((x) => x.mate === 'north');
		expect(r).toMatchObject({
			key: 'docket/dk-schema@north',
			path: 'data/remote-secondmates/north/data/dk-schema/report.md'
		});
	});

	it('lists a task’s prototype, running when its last address answers', async () => {
		let p = (await docs.index()).prototypes.find((x) => x.task === 'wh-pal')!;
		expect(p).toMatchObject({
			id: 'wheelhouse/wh-pal/main',
			title: 'Palette: clickable',
			state: 'stopped',
			url: 'http://127.0.0.1:4471/',
			source: 'data/wh-pal/prototype',
			record: 'wheelhouse/wh-pal'
		});
		answering.add('http://127.0.0.1:4471/');
		docs.invalidate();
		p = (await docs.index()).prototypes.find((x) => x.task === 'wh-pal')!;
		expect(p.state).toBe('running');
		const lone = (await docs.index()).prototypes.find((x) => x.task === 'proto-only')!;
		expect(lone).toMatchObject({ project: '_fleet', record: null, url: null });
	});

	it('finds a record by its task id, for the short link', async () => {
		expect((await docs.find('wh-pal'))?.key).toBe('wheelhouse/wh-pal');
		expect((await docs.find('dk-schema@north'))?.key).toBe('docket/dk-schema@north');
		expect(await docs.find('brief-only')).toBeNull();
	});
});

describe('a record', () => {
	it('holds the report and only the files inside its folder that it links', async () => {
		const v = (await docs.record('wheelhouse/wh-pal'))!;
		expect(v.files.map((f) => f.path).sort()).toEqual(['poster.html', 'shots/open.png']);
		expect(v.prototypes.map((p) => p.id)).toEqual(['wheelhouse/wh-pal/main']);
		expect(v.finished).toBe('2026-11-10');
		expect(v.source).toBe('data/wh-pal');
		expect(await docs.record('wheelhouse/nope')).toBeNull();
		expect(await docs.record('../etc')).toBeNull();
	});

	it('serves those files, HTML included, and nothing else however it is named', async () => {
		expect(await docs.recordFile('wheelhouse/wh-pal', 'poster.html')).toMatchObject({
			type: 'text/html; charset=utf-8'
		});
		expect(await docs.recordFile('wheelhouse/wh-pal', 'report.md')).toMatchObject({
			type: 'text/plain; charset=utf-8'
		});
		for (const bad of [
			'notes.txt',
			'prototype/index.html',
			'../wh-pal/poster.html',
			'linked/secret.png',
			'../../../elsewhere/secret.png',
			'report2.md'
		])
			expect(await docs.recordFile('wheelhouse/wh-pal', bad), bad).toBeNull();
	});

	it('reads the targets a report links, outside code blocks', () => {
		expect(
			linkTargets('[a](x.png "t") <img src="y.svg"> ```\n[no](z.png)\n```\n[ref]: refs/r.html')
		).toEqual(['x.png', 'refs/r.html', 'y.svg']);
	});
});

describe('briefing for a Live discussion', () => {
	it('attaches reports in full, lists others by title with their file, and never a prototype’s files', async () => {
		const b = await docs.briefing(
			['wheelhouse/wh-pal', 'proto:wheelhouse/wh-pal/main'],
			['docket/dk-ship', 'nope/nope']
		);
		expect(b.attached).toEqual(['Command palette: flow']);
		expect(b.listed).toEqual(['Palette: clickable', 'Ingest retries: what landed']);
		expect(b.text).toContain('### Command palette: flow');
		expect(b.text).toContain(path.join(home, 'data', 'dk-ship', 'report.md'));
		expect(b.text).not.toContain('<h1>live</h1>');
	});

	it('lists a report too long to attach instead', async () => {
		const b = await docs.briefing(['wheelhouse/wh-pal'], [], 10);
		expect(b).toMatchObject({ attached: [], cut: ['Command palette: flow'] });
		expect((await docs.briefing([], [])).text).toBe('');
	});
});
