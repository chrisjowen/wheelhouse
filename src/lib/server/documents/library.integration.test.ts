import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FleetView } from '$lib/types';
import { Library, rewriteLink } from './library';
import { DocumentsService } from './service';

let tmp: string;
let home: string;
let lib: Library;
let docs: DocumentsService;

beforeAll(async () => {
	tmp = await realpath(await mkdtemp(path.join(os.tmpdir(), 'wh-library-')));
	home = path.join(tmp, 'home');
	const task = path.join(home, 'data', 'wh-pal');
	await mkdir(path.join(task, 'shots'), { recursive: true });
	await mkdir(path.join(task, 'prototype'), { recursive: true });
	await mkdir(path.join(home, 'state'), { recursive: true });
	await writeFile(
		path.join(home, 'data', 'done-archive.md'),
		'- [x] wh-pal - Palette (repo: wheelhouse) (kind: scout) (reported 2026-11-10)\n'
	);
	await writeFile(
		path.join(task, 'report.md'),
		'---\ntags: [palette]\n---\n\n# Command palette\n\n![open](./shots/open.png)\n\nTry [the prototype](prototype/index.html).\n'
	);
	await writeFile(path.join(task, 'shots', 'open.png'), 'png');
	await writeFile(path.join(task, 'prototype', 'index.html'), '<p>live</p>');
	lib = new Library(path.join(tmp, 'state', 'library'));
	docs = new DocumentsService({
		home,
		library: lib,
		libraryProblem: null,
		fleet: () => ({ tasks: [], secondMates: [] }) as unknown as FleetView,
		answers: async () => false
	});
});

afterAll(async () => {
	await rm(tmp, { recursive: true, force: true });
});

describe('the library', () => {
	it('is empty, and makes no repository, before the first promotion', async () => {
		expect(await lib.list()).toEqual([]);
		expect((await docs.index()).library).toEqual([]);
	});

	it('promotes a record: copies its report and files, links its prototype, and commits', async () => {
		const r = await docs.promote({
			record: 'wheelhouse/wh-pal',
			title: 'Palette: how it works',
			shelf: 'wheelhouse',
			folder: 'Guides',
			slug: 'palette',
			tags: ['Palette', 'keyboard']
		});
		expect(r).toMatchObject({
			ok: true,
			key: 'wheelhouse/guides/palette',
			message: 'promote: wheelhouse/guides/palette from records/wheelhouse/wh-pal'
		});
		const text = await readFile(path.join(lib.root, 'wheelhouse/guides/palette.md'), 'utf8');
		expect(text).toMatch(
			/^---\ntitle: "Palette: how it works"\nstatus: current\ntags: \[palette, keyboard\]\npromoted_from: records\/wheelhouse\/wh-pal\nprototypes: \[wheelhouse\/wh-pal\/main\]\n/
		);
		expect(text).toContain('![open](palette/shots/open.png)');
		expect(text).toContain('[the prototype](/prototypes/wheelhouse/wh-pal/main)');
		expect(
			await readFile(path.join(lib.root, 'wheelhouse/guides/palette/shots/open.png'), 'utf8')
		).toBe('png');
		// The record itself is untouched.
		expect(await readFile(path.join(home, 'data', 'wh-pal', 'report.md'), 'utf8')).toContain(
			'(./shots/open.png)'
		);
		const log = execFileSync('git', ['-C', lib.root, 'log', '--format=%s'], { encoding: 'utf8' });
		expect(log.trim().split('\n')).toEqual([
			'promote: wheelhouse/guides/palette from records/wheelhouse/wh-pal',
			'library: start'
		]);
	});

	it('lists the document with its folder, tags and history, and marks the record promoted', async () => {
		const index = await docs.index();
		expect(index.library).toMatchObject([
			{
				key: 'wheelhouse/guides/palette',
				shelf: 'wheelhouse',
				folder: 'guides',
				title: 'Palette: how it works',
				status: 'current',
				tags: ['palette', 'keyboard'],
				from: 'wheelhouse/wh-pal',
				commits: 1
			}
		]);
		expect(index.records[0].promotedTo).toBe('wheelhouse/guides/palette');
		const read = (await docs.libraryDoc('wheelhouse/guides/palette'))!;
		expect(read.history.map((h) => h.subject)).toEqual([
			'promote: wheelhouse/guides/palette from records/wheelhouse/wh-pal'
		]);
		expect(read.attachments).toEqual(['shots/open.png']);
		expect(read.record?.key).toBe('wheelhouse/wh-pal');
		expect(await lib.folders()).toEqual({ wheelhouse: ['guides'] });
	});

	it('follows an edit Firstmate commits', async () => {
		const file = path.join(lib.root, 'wheelhouse/guides/palette.md');
		await writeFile(
			file,
			(await readFile(file, 'utf8')).replace('status: current', 'status: draft')
		);
		execFileSync(
			'git',
			['-C', lib.root, 'commit', '-qam', 'edit: mark it a draft (asked in chat)'],
			{
				env: {
					...process.env,
					GIT_AUTHOR_NAME: 'F',
					GIT_AUTHOR_EMAIL: 'f@x',
					GIT_COMMITTER_NAME: 'F',
					GIT_COMMITTER_EMAIL: 'f@x'
				}
			}
		);
		const read = (await docs.libraryDoc('wheelhouse/guides/palette'))!;
		expect(read.doc).toMatchObject({ status: 'draft', commits: 2 });
		expect(read.history[0].subject).toBe('edit: mark it a draft (asked in chat)');
	});

	it('refuses a second document at the same place, and names it cannot use', async () => {
		const again = await docs.promote({
			record: 'wheelhouse/wh-pal',
			shelf: 'wheelhouse',
			folder: 'guides',
			slug: 'palette'
		});
		expect(again).toMatchObject({ ok: false, status: 409 });
		expect(await docs.promote({ record: 'wheelhouse/nope' })).toMatchObject({
			ok: false,
			status: 400
		});
		expect(await docs.promote({ record: 'wheelhouse/wh-pal', shelf: '../etc' })).toMatchObject({
			ok: false,
			status: 400
		});
		expect(await lib.read('../x/y')).toBeNull();
		expect(await docs.libraryFile('wheelhouse/guides/palette', '../palette.md')).toBeNull();
		expect(await docs.libraryFile('wheelhouse/guides/palette', 'shots/open.png')).toMatchObject({
			type: 'image/png'
		});
	});
});

describe('rewriteLink', () => {
	it('moves links and images to the copied file, as written or with ./', () => {
		expect(
			rewriteLink(
				'![a](./x.png) [b](x.png#top) <img src="x.png"> [c](x.png.bak)',
				'x.png',
				'd/x.png'
			)
		).toBe('![a](d/x.png) [b](d/x.png#top) <img src="d/x.png"> [c](x.png.bak)');
	});
});
