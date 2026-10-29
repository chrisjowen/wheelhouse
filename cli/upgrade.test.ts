import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RestartOutcome } from '../src/lib/server/plugins/install';
import { upgrade, type UpgradeCliDeps } from './upgrade';

/**
 * `wheelhouse upgrade` against a clone of a local bare repository standing in
 * for GitHub. npm and restarting a running Wheelhouse are stand-ins that
 * record each call.
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
let upstream: string;
let clone: string;
let lines: string[];
let ran: string[];
let answers: boolean[];
let restarts: number;
let busy: string[];

function release(version: string, subject: string) {
	writeFileSync(path.join(upstream, 'package.json'), JSON.stringify({ version }));
	git(upstream, 'add', 'package.json');
	git(upstream, 'commit', '-q', '-m', subject);
	git(upstream, 'push', '-q', 'origin', 'main');
}

function deps(): UpgradeCliDeps {
	return {
		dir: clone,
		run: async (cmd, args) => {
			ran.push([cmd, ...args].join(' '));
			return { code: 0, output: '' };
		},
		confirm: async () => answers.shift() ?? false,
		restart: async (proceed): Promise<RestartOutcome> => {
			restarts++;
			const url = 'http://127.0.0.1:4310/';
			if (busy.length && !(await proceed(url, busy))) {
				return { restarted: [], failed: [], kept: [url] };
			}
			return { restarted: [url], failed: [], kept: [] };
		},
		log: (l) => lines.push(l)
	};
}

beforeEach(() => {
	root = mkdtempSync(path.join(tmpdir(), 'wh-upgrade-cli-'));
	const origin = path.join(root, 'origin.git');
	upstream = path.join(root, 'upstream');
	clone = path.join(root, 'clone');
	execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin]);
	execFileSync('git', ['clone', '-q', origin, upstream], { stdio: 'ignore' });
	git(upstream, 'checkout', '-q', '-b', 'main');
	release('0.1.0', 'chore: start');
	execFileSync('git', ['clone', '-q', origin, clone], { stdio: 'ignore' });
	lines = [];
	ran = [];
	answers = [];
	restarts = 0;
	busy = [];
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('wheelhouse upgrade', () => {
	it('says when Wheelhouse is up to date, and changes nothing', async () => {
		expect(await upgrade(deps())).toBe(true);
		expect(lines.join('\n')).toMatch(/0\.1\.0 \(\w{7}\) is up to date with origin main/);
		expect(ran).toEqual([]);
		expect(restarts).toBe(0);
	});

	it('lists what is new, and with --check stops there', async () => {
		release('0.2.0', 'feat: two');
		expect(await upgrade(deps(), { check: true })).toBe(true);
		expect(lines.join('\n')).toMatch(/1 new commit: Wheelhouse 0\.1\.0 .* → 0\.2\.0/);
		expect(lines.join('\n')).toContain('feat: two');
		expect(ran).toEqual([]);
	});

	it('asks, then fast-forwards, reinstalls, rebuilds and restarts Wheelhouse', async () => {
		release('0.2.0', 'feat: two');
		answers = [true];
		expect(await upgrade(deps())).toBe(true);
		expect(ran).toEqual(['npm ci', 'npm run build']);
		expect(git(clone, 'rev-parse', 'HEAD')).toBe(git(upstream, 'rev-parse', 'HEAD'));
		expect(restarts).toBe(1);
		expect(lines).toContain('Restarting Wheelhouse at http://127.0.0.1:4310/.');
	});

	it('changes nothing when the captain says no', async () => {
		release('0.2.0', 'feat: two');
		const before = git(clone, 'rev-parse', 'HEAD');
		expect(await upgrade(deps())).toBe(false);
		expect(git(clone, 'rev-parse', 'HEAD')).toBe(before);
		expect(ran).toEqual([]);
	});

	it('refuses a clone with local changes, names them, and changes nothing', async () => {
		release('0.2.0', 'feat: two');
		writeFileSync(path.join(clone, 'package.json'), '{}');
		const before = git(clone, 'rev-parse', 'HEAD');
		expect(await upgrade(deps(), { yes: true })).toBe(false);
		expect(lines.join('\n')).toMatch(/has local changes/);
		expect(lines).toContain('   M package.json');
		expect(lines).toContain('Nothing was changed.');
		expect(git(clone, 'rev-parse', 'HEAD')).toBe(before);
		expect(git(clone, 'status', '--porcelain')).toBe('M package.json');
		expect(ran).toEqual([]);
		expect(restarts).toBe(0);
	});

	it('refuses a clone that has diverged', async () => {
		release('0.2.0', 'feat: two');
		writeFileSync(path.join(clone, 'mine.txt'), 'x');
		git(clone, 'add', 'mine.txt');
		git(clone, 'commit', '-q', '-m', 'local');
		expect(await upgrade(deps(), { yes: true })).toBe(false);
		expect(lines.join('\n')).toMatch(/1 commit that main does not/);
		expect(ran).toEqual([]);
	});

	it('leaves a busy Wheelhouse running when the captain will not stop its work', async () => {
		release('0.2.0', 'feat: two');
		busy = ['a PR review agent on wheelhouse#70'];
		answers = [true, false];
		expect(await upgrade(deps())).toBe(true);
		expect(lines).toContain('  - a PR review agent on wheelhouse#70');
		expect(lines.join('\n')).toMatch(/Left Wheelhouse at .* running the old version/);
	});
});
