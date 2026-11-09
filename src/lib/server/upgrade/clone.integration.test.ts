import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkClone, githubRepository, upgradeClone, type Run } from './clone';

/**
 * Checking and upgrading a clone against a local bare repository standing in
 * for GitHub. npm is a stand-in that records what it was asked to run.
 */

const env = {
	...process.env,
	GIT_AUTHOR_NAME: 't',
	GIT_AUTHOR_EMAIL: 't@t',
	GIT_COMMITTER_NAME: 't',
	GIT_COMMITTER_EMAIL: 't@t'
};
const git = (cwd: string, ...args: string[]) =>
	execFileSync('git', ['-C', cwd, ...args], { env, stdio: ['ignore', 'pipe', 'pipe'] })
		.toString()
		.trim();

let root: string;
let origin: string;
let upstream: string;
let clone: string;
let ran: string[];
let npm: Run;

function commit(dir: string, file: string, text: string, subject: string) {
	writeFileSync(path.join(dir, file), text);
	git(dir, 'add', file);
	git(dir, 'commit', '-q', '-m', subject);
}

function release(version: string, subject: string) {
	commit(upstream, 'package.json', JSON.stringify({ name: 'wheelhouse', version }), subject);
	git(upstream, 'push', '-q', 'origin', 'main');
}

beforeEach(() => {
	root = mkdtempSync(path.join(tmpdir(), 'wh-upgrade-'));
	origin = path.join(root, 'origin.git');
	upstream = path.join(root, 'upstream');
	clone = path.join(root, 'clone');
	execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin]);
	execFileSync('git', ['clone', '-q', origin, upstream], { stdio: 'ignore' });
	git(upstream, 'checkout', '-q', '-b', 'main');
	release('0.1.0', 'chore: start');
	execFileSync('git', ['clone', '-q', origin, clone], { stdio: 'ignore' });
	ran = [];
	npm = async (cmd, args) => {
		ran.push([cmd, ...args].join(' '));
		return { code: 0, output: '' };
	};
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('checkClone', () => {
	it('is current when the clone has everything on the default branch', async () => {
		const c = await checkClone({ dir: clone });
		expect(c.state).toBe('current');
		expect(c.branch).toBe('main');
		expect(c.behind).toBe(0);
		expect(c.current.version).toBe('0.1.0');
	});

	it('lists the new commits, newest first, and the version they bring', async () => {
		release('0.1.1', 'fix: one');
		release('0.2.0', 'feat: two');
		const c = await checkClone({ dir: clone });
		expect(c.state).toBe('available');
		expect(c.behind).toBe(2);
		expect(c.commits.map((x) => x.subject)).toEqual(['feat: two', 'fix: one']);
		expect(c.latest?.version).toBe('0.2.0');
		expect(c.latest?.commit).toBe(git(upstream, 'rev-parse', 'HEAD'));
		// Checking only fetched: the clone itself has not moved.
		expect(git(clone, 'rev-parse', 'HEAD')).toBe(c.current.commit);
	});

	it('refuses a clone with local changes, and names them', async () => {
		release('0.1.1', 'fix: one');
		writeFileSync(path.join(clone, 'package.json'), '{"version":"9.9.9"}');
		const c = await checkClone({ dir: clone });
		expect(c.state).toBe('refused');
		expect(c.reason).toMatch(/local changes/);
		expect(c.changes).toEqual([' M package.json']);
	});

	it('does not count untracked files as local changes', async () => {
		release('0.1.1', 'fix: one');
		writeFileSync(path.join(clone, 'notes.md'), 'mine');
		expect((await checkClone({ dir: clone })).state).toBe('available');
	});

	it('refuses a clone that has diverged from the default branch', async () => {
		release('0.1.1', 'fix: one');
		commit(clone, 'local.txt', 'mine', 'local work');
		const c = await checkClone({ dir: clone });
		expect(c.state).toBe('refused');
		expect(c.reason).toMatch(/1 commit that main does not/);
	});

	it('refuses a clone on another branch or a detached HEAD', async () => {
		release('0.1.1', 'fix: one');
		git(clone, 'checkout', '-q', '-b', 'experiment');
		expect((await checkClone({ dir: clone })).reason).toMatch(/on experiment, not main/);
		git(clone, 'checkout', '-q', '--detach');
		expect((await checkClone({ dir: clone })).reason).toMatch(/detached HEAD/);
	});

	it('cannot upgrade what is not a git clone', async () => {
		const plain = path.join(root, 'plain');
		execFileSync('mkdir', [plain]);
		const c = await checkClone({ dir: plain });
		expect(c.state).toBe('unsupported');
		expect(c.reason).toMatch(/not a git clone/);
	});

	it('says when origin cannot be reached', async () => {
		git(clone, 'remote', 'set-url', 'origin', path.join(root, 'gone.git'));
		const c = await checkClone({ dir: clone });
		expect(c.state).toBe('error');
		expect(c.reason).toMatch(/could not reach origin/);
	});
});

describe('upgradeClone', () => {
	it('fast-forwards, then runs npm ci and npm run build', async () => {
		release('0.2.0', 'feat: two');
		const steps: string[] = [];
		const r = await upgradeClone({ dir: clone, run: npm }, (s) => steps.push(s));
		expect(r.ok).toBe(true);
		expect(steps).toEqual(['fetch', 'fast-forward', 'install', 'build']);
		expect(ran).toEqual(['npm ci', 'npm run build']);
		expect(git(clone, 'rev-parse', 'HEAD')).toBe(git(upstream, 'rev-parse', 'HEAD'));
	});

	it('refuses, changing nothing, when the clone has local changes', async () => {
		release('0.2.0', 'feat: two');
		writeFileSync(path.join(clone, 'package.json'), '{"version":"9.9.9"}');
		const before = git(clone, 'rev-parse', 'HEAD');
		const r = await upgradeClone({ dir: clone, run: npm });
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.error).toMatch(/local changes/);
		expect(git(clone, 'rev-parse', 'HEAD')).toBe(before);
		expect(git(clone, 'status', '--porcelain')).toBe('M package.json');
		expect(git(clone, 'stash', 'list')).toBe('');
		expect(ran).toEqual([]);
	});

	it('refuses, changing nothing, when the clone has diverged', async () => {
		release('0.2.0', 'feat: two');
		commit(clone, 'local.txt', 'mine', 'local work');
		const before = git(clone, 'rev-parse', 'HEAD');
		const r = await upgradeClone({ dir: clone, run: npm });
		expect(r.ok).toBe(false);
		expect(git(clone, 'rev-parse', 'HEAD')).toBe(before);
		expect(ran).toEqual([]);
	});

	it('says it is up to date when there is nothing new', async () => {
		const r = await upgradeClone({ dir: clone, run: npm });
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.error).toMatch(/already up to date/);
	});

	it('stops at a failed build and says what is left where', async () => {
		release('0.2.0', 'feat: two');
		const r = await upgradeClone({
			dir: clone,
			run: async (cmd, args) => {
				ran.push([cmd, ...args].join(' '));
				return args[0] === 'run' ? { code: 2, output: 'error TS2304' } : { code: 0, output: '' };
			}
		});
		expect(r.ok).toBe(false);
		if (!r.ok) {
			expect(r.step).toBe('build');
			expect(r.output).toBe('error TS2304');
			expect(r.error).toMatch(/build is incomplete.*npm ci && npm run build/);
		}
	});
});

describe('githubRepository', () => {
	it('reads org/repo from https and ssh remotes', () => {
		expect(githubRepository('https://github.com/chrisjowen/wheelhouse.git')).toBe(
			'chrisjowen/wheelhouse'
		);
		expect(githubRepository('git@github.com:chrisjowen/wheelhouse.git\n')).toBe(
			'chrisjowen/wheelhouse'
		);
		expect(githubRepository('ssh://git@github.com/acme/tool')).toBe('acme/tool');
		expect(githubRepository('https://gitlab.com/acme/tool.git')).toBeNull();
	});
});
