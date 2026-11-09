import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { RequestEvent } from '@sveltejs/kit';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
	createFakeFirstmate,
	type FakeFirstmate
} from '../../../../../../tests/helpers/fake-firstmate';
import { createScriptAdapter } from '$lib/server/firstmate/adapter';
import { EvidenceReader } from '$lib/server/firstmate/evidence';
import { MateTasks } from '$lib/server/firstmate/matetasks';
import { RemoteGit } from '$lib/server/firstmate/remotegit';
import type { SecondMate } from '$lib/types';

const state = vi.hoisted(() => ({ runtime: null as unknown }));
vi.mock('$lib/server/runtime', () => ({ getRuntime: async () => state.runtime }));

const { GET } = await import('./+server');

/** A fake ssh: logs the call and runs the command line it was given, as the host's shell would. */
const FAKE_SSH = `#!/bin/sh
D="$(dirname "$0")"
for a in "$@"; do printf '[%s]' "$a" >> "$D/ssh.log"; done
echo >> "$D/ssh.log"
while [ "$#" -gt 0 ] && [ "$1" != -- ]; do shift; done
shift; shift
cd "$D" || exit 1
exec sh -c "$1"
`;

let fm: FakeFirstmate;
let dir: string;
const tokyo = {
	id: 'tokyo',
	where: 'remote',
	host: 'tokyo-box',
	home: '/home/fm/tokyo',
	inFlight: [{ id: 'tk-1', title: 'Share', status: 'working' }],
	queued: [],
	landed: [],
	peek: { available: true, reason: null },
	health: { online: 'online' }
} as unknown as SecondMate;

beforeAll(() => {
	dir = mkdtempSync(path.join(tmpdir(), 'wh-diff-route-'));
	const bin = path.join(dir, 'bin');
	mkdirSync(bin);
	writeFileSync(path.join(bin, 'ssh'), FAKE_SSH, { mode: 0o755 });
	// The task's worktree "on the mate": one commit, one uncommitted edit, one untracked file.
	const wt = path.join(dir, 'wt');
	mkdirSync(wt);
	const g = (...a: string[]) =>
		execFileSync('git', a, {
			cwd: wt,
			env: {
				...process.env,
				GIT_AUTHOR_NAME: 't',
				GIT_AUTHOR_EMAIL: 't@t',
				GIT_COMMITTER_NAME: 't',
				GIT_COMMITTER_EMAIL: 't@t'
			}
		});
	g('init', '-q', '-b', 'main');
	writeFileSync(path.join(wt, 'share.ts'), 'old\n');
	g('add', '.');
	g('commit', '-q', '-m', 'base');
	g('checkout', '-q', '-b', 'fm/tk-1');
	writeFileSync(path.join(wt, 'share.ts'), 'new\nmore\n');
	writeFileSync(path.join(wt, 'notes.md'), 'draft\n');

	fm = createFakeFirstmate();
	// Its meta in the second mate's home, as fm-remote-file.sh sends it.
	fm.set('fm-on/fm-remote-file.sh', `worktree=${wt}\nbranch=fm/tk-1\n`);
	const adapter = createScriptAdapter({ firstmateDir: fm.root, homeDir: fm.root });
	const evidence = new EvidenceReader({
		dataDir: path.join(fm.root, 'data'),
		useGh: false,
		evidenceDir: null,
		logsDir: null
	});
	const mateTasks = new MateTasks({
		adapter,
		mates: () => [tokyo],
		forwards: { open: vi.fn(), retain: vi.fn() },
		evidence,
		remoteGit: new RemoteGit({ ssh: path.join(bin, 'ssh') }),
		check: vi.fn()
	});
	state.runtime = {
		configured: true,
		collector: {
			getFleet: () => ({
				tasks: [
					{ id: 'wh-1', secondMate: null },
					{ id: 'tk-1@tokyo', secondMate: { id: 'tokyo', where: 'remote' } }
				]
			}),
			row: () => null
		},
		evidence,
		mateTasks
	};
});
afterAll(() => {
	fm.cleanup();
	rmSync(dir, { recursive: true, force: true });
});

const get = async (id: string, file: string) => {
	const url = new URL(
		`http://127.0.0.1:4310/api/tasks/${encodeURIComponent(id)}/diff?path=${encodeURIComponent(file)}`
	);
	const event = { params: { id }, url, request: new Request(url) } as unknown as RequestEvent;
	const res = await GET(event as Parameters<typeof GET>[0]);
	expect(res.headers.get('cache-control')).toBe('no-store');
	return res.json();
};

describe('GET /api/tasks/[id]/diff for a remote second mate’s task', () => {
	it('shows an uncommitted file’s diff, read over ssh in its recorded worktree', async () => {
		expect(await get('tk-1@tokyo', 'share.ts')).toMatchObject({
			available: true,
			source:
				'git diff against main in the task worktree on second mate tokyo, including uncommitted changes',
			value: { path: 'share.ts', base: 'main', lines: ['@@ -1 +1,2 @@', '-old', '+new', '+more'] }
		});
		const calls = readFileSync(path.join(dir, 'bin', 'ssh.log'), 'utf8');
		expect(calls).toContain('[--][tokyo-box][');
		expect(calls).not.toContain('fetch');
	});

	it('shows an untracked file as new', async () => {
		expect(await get('tk-1@tokyo', 'notes.md')).toMatchObject({
			available: true,
			source: 'the new, uncommitted file in the task worktree on second mate tokyo',
			value: { lines: ['@@ -0,0 +1 @@', '+draft'] }
		});
	});

	it('refuses a path the task did not change, without asking the host', async () => {
		const before = readFileSync(path.join(dir, 'bin', 'ssh.log'), 'utf8');
		expect(await get('tk-1@tokyo', '../../etc/passwd')).toMatchObject({
			available: false,
			reason: expect.stringMatching(/not in this task’s list/)
		});
		expect(readFileSync(path.join(dir, 'bin', 'ssh.log'), 'utf8')).toBe(before);
	});

	it('still says a captain’s task without a worktree is gone', async () => {
		expect(await get('wh-1', 'a.txt')).toMatchObject({
			available: false,
			reason: expect.stringMatching(/worktree is gone/)
		});
	});
});
