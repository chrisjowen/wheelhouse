import { execFileSync } from 'node:child_process';
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { which } from '../sessions/tmux';
import { checkLocation, cloneFirstmate, expandPath, foundFirstmates } from './location';

let root: string;
beforeEach(() => {
	root = mkdtempSync(path.join(tmpdir(), 'wh-location-'));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const opts = () => ({ ownDirs: [path.join(root, 'wh-state')], home: root });

/** A git repository that looks like Firstmate (bin/fm-fleet-snapshot.sh), to clone from. */
function firstmateRepo(): string {
	const repo = path.join(root, 'origin');
	mkdirSync(path.join(repo, 'bin'), { recursive: true });
	writeFileSync(path.join(repo, 'bin', 'fm-fleet-snapshot.sh'), '#!/bin/sh\n');
	writeFileSync(path.join(repo, 'README.md'), 'firstmate\n');
	const git = (...args: string[]) =>
		execFileSync('git', args, {
			cwd: repo,
			env: {
				...process.env,
				GIT_AUTHOR_NAME: 't',
				GIT_AUTHOR_EMAIL: 't@example.com',
				GIT_COMMITTER_NAME: 't',
				GIT_COMMITTER_EMAIL: 't@example.com'
			}
		});
	git('init', '-q');
	git('add', '.');
	git('commit', '-qm', 'init');
	return repo;
}

describe('expandPath', () => {
	it('expands ~ and refuses relative or empty paths', () => {
		expect(expandPath('~/firstmate', '/home/me')).toBe('/home/me/firstmate');
		expect(expandPath('~', '/home/me')).toBe('/home/me');
		expect(expandPath(' /opt/fm/ ', '/home/me')).toBe('/opt/fm');
		expect(expandPath('firstmate', '/home/me')).toBeNull();
		expect(expandPath('  ', '/home/me')).toBeNull();
	});
});

describe('checkLocation: never overwrite', () => {
	it('offers a folder that does not exist yet', () => {
		expect(checkLocation(path.join(root, 'a', 'firstmate'), opts()).kind).toBe('new');
	});

	it('offers an empty folder', () => {
		mkdirSync(path.join(root, 'empty'));
		expect(checkLocation(path.join(root, 'empty'), opts()).kind).toBe('empty');
	});

	it('refuses a folder with anything in it, a file and a link', () => {
		mkdirSync(path.join(root, 'full'));
		writeFileSync(path.join(root, 'full', 'notes.txt'), 'mine');
		writeFileSync(path.join(root, 'file'), 'mine');
		symlinkSync(path.join(root, 'full'), path.join(root, 'link'));
		for (const p of ['full', 'file', 'link']) {
			const c = checkLocation(path.join(root, p), opts());
			expect(c.kind, p).toBe('occupied');
			expect(c.message).toMatch(/never/);
		}
	});

	it('offers to use a Firstmate checkout as it is', () => {
		mkdirSync(path.join(root, 'fm', 'bin'), { recursive: true });
		writeFileSync(path.join(root, 'fm', 'bin', 'fm-fleet-snapshot.sh'), '');
		expect(checkLocation(path.join(root, 'fm'), opts()).kind).toBe('firstmate');
		expect(foundFirstmates({ FM_HOME: path.join(root, 'fm') }, root)).toEqual([
			path.join(root, 'fm')
		]);
	});

	it('refuses Wheelhouse’s own folders, the disk’s top and a relative path', () => {
		expect(checkLocation(root, opts()).kind).toBe('invalid');
		expect(checkLocation(path.join(root, 'wh-state', 'fm'), opts()).kind).toBe('invalid');
		expect(checkLocation('/', opts()).kind).toBe('invalid');
		expect(checkLocation('somewhere', opts()).kind).toBe('invalid');
		writeFileSync(path.join(root, 'plain'), '');
		expect(checkLocation(path.join(root, 'plain', 'fm'), opts()).kind).toBe('invalid');
	});
});

describe.skipIf(!which('git', process.env.PATH))('cloneFirstmate', () => {
	const git = which('git', process.env.PATH) as string;

	it('clones into a new folder and makes the home’s state/', async () => {
		const repository = firstmateRepo();
		const dir = path.join(root, 'new', 'firstmate');
		const r = await cloneFirstmate(dir, { ...opts(), git, repository, env: process.env });
		expect(r).toMatchObject({ ok: true, dir });
		expect(readFileSync(path.join(dir, 'README.md'), 'utf8')).toBe('firstmate\n');
		expect(existsSync(path.join(dir, 'state'))).toBe(true);
	});

	it('clones into an empty folder', async () => {
		const repository = firstmateRepo();
		const dir = path.join(root, 'empty');
		mkdirSync(dir);
		expect(
			await cloneFirstmate(dir, { ...opts(), git, repository, env: process.env })
		).toMatchObject({
			ok: true
		});
	});

	it('never touches a folder that is not empty', async () => {
		const repository = firstmateRepo();
		const dir = path.join(root, 'mine');
		mkdirSync(dir);
		writeFileSync(path.join(dir, 'keep.txt'), 'precious');
		let ran = false;
		const r = await cloneFirstmate(dir, {
			...opts(),
			git,
			repository,
			env: process.env,
			run: async () => {
				ran = true;
				throw new Error('must not run');
			}
		});
		expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/never overwrites/) });
		expect(ran).toBe(false);
		expect(readdirSync(dir)).toEqual(['keep.txt']);
		expect(readFileSync(path.join(dir, 'keep.txt'), 'utf8')).toBe('precious');
	});

	it('says so when what it cloned is not Firstmate', async () => {
		const repo = firstmateRepo();
		rmSync(path.join(repo, 'bin'), { recursive: true });
		execFileSync('git', ['-C', repo, 'commit', '-qam', 'drop bin'], {
			env: {
				...process.env,
				GIT_AUTHOR_NAME: 't',
				GIT_AUTHOR_EMAIL: 't@e',
				GIT_COMMITTER_NAME: 't',
				GIT_COMMITTER_EMAIL: 't@e'
			}
		});
		const r = await cloneFirstmate(path.join(root, 'x'), {
			...opts(),
			git,
			repository: repo,
			env: process.env
		});
		expect(r).toMatchObject({
			ok: false,
			error: expect.stringMatching(/does not look like Firstmate/)
		});
	});

	it('reports a clone that fails', async () => {
		const r = await cloneFirstmate(path.join(root, 'y'), {
			...opts(),
			git,
			repository: path.join(root, 'no-such-repo'),
			env: process.env
		});
		expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/git clone failed/) });
	});
});
