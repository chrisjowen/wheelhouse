import { readFileSync } from 'node:fs';
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
import type { SecondMate } from '$lib/types';

const state = vi.hoisted(() => ({ runtime: null as unknown }));
vi.mock('$lib/server/runtime', () => ({ getRuntime: async () => state.runtime }));

const { GET } = await import('./+server');

// What Firstmate's fm-review-diff.sh prints in the remote second mate's home.
const REVIEW = [
	'diff base: origin/main',
	' src/share.ts | 3 ++-',
	' 1 file changed, 2 insertions(+), 1 deletion(-)',
	'',
	'diff --git a/src/share.ts b/src/share.ts',
	'index 1..2 100644',
	'--- a/src/share.ts',
	'+++ b/src/share.ts',
	'@@ -1 +1,2 @@',
	'-old',
	'+new',
	'+more',
	''
].join('\n');

let fm: FakeFirstmate;
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
	fm = createFakeFirstmate();
	fm.set('fm-on/fm-review-diff.sh', REVIEW);
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
afterAll(() => fm.cleanup());

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
	it('shows a changed file’s diff from Firstmate’s review diff on the mate’s host', async () => {
		expect(await get('tk-1@tokyo', 'src/share.ts')).toMatchObject({
			available: true,
			source: expect.stringContaining('second mate tokyo’s home'),
			value: {
				path: 'src/share.ts',
				base: 'origin/main',
				lines: ['@@ -1 +1,2 @@', '-old', '+new', '+more'],
				truncated: false
			}
		});
		const calls = readFileSync(path.join(fm.root, 'calls.log'), 'utf8');
		expect(calls).toContain('fm-on.sh [tokyo] [fm-review-diff.sh] [tk-1]');
	});

	it('refuses a path the task did not change', async () => {
		expect(await get('tk-1@tokyo', '../../etc/passwd')).toMatchObject({
			available: false,
			reason: expect.stringMatching(/not in this task’s list/)
		});
	});

	it('still says a captain’s task without a worktree is gone', async () => {
		expect(await get('wh-1', 'a.txt')).toMatchObject({
			available: false,
			reason: expect.stringMatching(/worktree is gone/)
		});
	});
});
