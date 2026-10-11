import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EvidenceReader, excerpt, parseDiff } from './evidence';

let dir: string;
let data: string;
let nm: string;
const reader = () => new EvidenceReader({ dataDir: data, useGh: false, evidenceDir: nm });

beforeEach(() => {
	dir = mkdtempSync(path.join(tmpdir(), 'wh-evidence-'));
	data = path.join(dir, 'data');
	nm = path.join(dir, 'nm-evidence');
	mkdirSync(path.join(data, 't-1', 'screenshots'), { recursive: true });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('screenshots', () => {
	it('lists the worker’s images first, then no-mistakes run evidence', async () => {
		writeFileSync(path.join(data, 't-1', 'screenshots', 'a.png'), 'x');
		writeFileSync(path.join(data, 't-1', 'shot-1.png'), 'x');
		writeFileSync(path.join(data, 't-1', 'notes.txt'), 'x');
		writeFileSync(path.join(data, 't-1', 'nm-01M4EVPEV7WZJSXGPV34AVXHB8-review-findings.txt'), 'x');
		mkdirSync(path.join(nm, '01M4EVPEV7WZJSXGPV34AVXHB8'), { recursive: true });
		writeFileSync(path.join(nm, '01M4EVPEV7WZJSXGPV34AVXHB8', 'r1-ui.png'), 'x');
		const names = (await reader().screenshots('t-1')).map((s) => s.name).sort();
		expect(names).toEqual([
			'nm/01M4EVPEV7WZJSXGPV34AVXHB8/r1-ui.png',
			'screenshots/a.png',
			'shot-1.png'
		]);
	});

	it('serves only listed screenshots, never arbitrary paths', async () => {
		writeFileSync(path.join(data, 't-1', 'screenshots', 'a.png'), 'x');
		writeFileSync(path.join(data, 'backlog.md'), 'secret');
		const r = reader();
		expect(await r.artifactFile('t-1', 'screenshots/a.png')).toBe(
			path.join(data, 't-1', 'screenshots', 'a.png')
		);
		for (const bad of [
			'../backlog.md',
			'../../etc/passwd',
			'screenshots/../../backlog.md',
			'/etc/passwd',
			'notes.txt'
		]) {
			expect(await r.artifactFile('t-1', bad)).toBeNull();
		}
		expect(await r.artifactFile('../data', 'backlog.md')).toBeNull();
	});
});

describe('pr', () => {
	it('reads Firstmate’s cached PR observation', async () => {
		const url = 'https://github.com/o/r/pull/33';
		writeFileSync(
			path.join(data, 't-1', 'contributions.json'),
			JSON.stringify({
				schema: 'fm-contributions.v1',
				records: [
					{
						url,
						kind: 'pr',
						checked_at: '2026-10-08T16:53:56Z',
						observation: {
							state: 'open',
							draft: false,
							review_decision: 'REVIEW_REQUIRED',
							checks: [
								{ name: 'check', status: 'completed', conclusion: 'success' },
								{ name: 'e2e', status: 'in_progress', conclusion: null }
							]
						}
					}
				]
			})
		);
		const pr = await reader().pr('t-1', url);
		expect(pr.available).toBe(true);
		if (pr.available) {
			expect(pr.value).toMatchObject({ number: 33, state: 'open', draft: false });
			expect(pr.value.checks).toEqual([
				{ name: 'check', state: 'pass' },
				{ name: 'e2e', state: 'running' }
			]);
			expect(pr.observedAt).toBe('2026-10-08T16:53:56Z');
		}
	});

	it('says why PR state is unavailable', async () => {
		expect(await reader().pr('t-1', null)).toMatchObject({ available: false });
		expect(await reader().pr('t-1', 'https://github.com/o/r/pull/1')).toMatchObject({
			available: false
		});
	});
});

describe('diff', () => {
	it('lists committed, uncommitted and untracked changes against the base branch', async () => {
		const repo = path.join(dir, 'repo');
		mkdirSync(repo);
		const git = (...a: string[]) => execFileSync('git', ['-C', repo, ...a], { stdio: 'pipe' });
		git('init', '-q', '-b', 'main');
		git('config', 'user.email', 't@t');
		git('config', 'user.name', 't');
		writeFileSync(path.join(repo, 'a.txt'), 'one\n');
		git('add', '.');
		git('commit', '-qm', 'base');
		git('checkout', '-qb', 'fm/t-1');
		writeFileSync(path.join(repo, 'a.txt'), 'one\ntwo\n');
		git('commit', '-qam', 'work');
		writeFileSync(path.join(repo, 'b.txt'), 'new\n');
		const d = await reader().diff(repo);
		expect(d.available).toBe(true);
		if (d.available) {
			expect(d.value.base).toBe('main');
			expect(d.value.branch).toBe('fm/t-1');
			expect(d.value.files).toEqual([
				{ path: 'a.txt', status: 'M', additions: 1, deletions: 0 },
				{ path: 'b.txt', status: '?', additions: null, deletions: null }
			]);
		}
	});

	it('is unavailable without a recorded worktree', async () => {
		expect(await reader().diff(null)).toMatchObject({ available: false });
	});
});

it('parseDiff handles renames and binary files', () => {
	const files = parseDiff(
		'3\t1\tsrc/{old => new}.ts\n-\t-\timg.png\n',
		'R100\tsrc/old.ts\tsrc/new.ts\nA\timg.png\n'
	);
	expect(files).toEqual([
		{ path: 'src/new.ts', status: 'R', additions: 3, deletions: 1 },
		{ path: 'img.png', status: 'A', additions: null, deletions: null }
	]);
});

it('excerpt takes the first prose paragraph without Markdown', () => {
	expect(excerpt('# Title\n\n**Status:** it is `live` at [x](http://y).\n\nMore.')).toBe(
		'Status: it is live at x.'
	);
});
