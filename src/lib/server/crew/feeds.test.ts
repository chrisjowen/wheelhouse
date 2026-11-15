import { mkdirSync, mkdtempSync, realpathSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { transcriptDirName } from '../buildlog/reader';
import type { FeedEvent } from '../sessions/transcript';
import { locateWorkerTranscript, MAX_FEEDS, WorkerFeeds, workerMeta, workerSession } from './feeds';

let root: string;
let home: string;
let projects: string;
let worktree: string;
const SPAWN = 1794693121;

function meta(task: string, lines: string[]) {
	writeFileSync(path.join(home, 'state', `${task}.meta`), `${lines.join('\n')}\n`);
}

/** A Claude Code transcript under the projects folder for `cwd`, last written at `mtime` (epoch s). */
function transcript(name: string, cwd: string, mtime: number, records: object[] = []) {
	const dir = path.join(projects, transcriptDirName(cwd));
	mkdirSync(dir, { recursive: true });
	const file = path.join(dir, `${name}.jsonl`);
	const lines = [{ type: 'system', subtype: 'init', cwd, uuid: `${name}-0` }, ...records];
	writeFileSync(file, lines.map((r) => JSON.stringify({ cwd, ...r })).join('\n') + '\n');
	utimesSync(file, mtime, mtime);
	return file;
}

beforeEach(() => {
	root = realpathSync(mkdtempSync(path.join(tmpdir(), 'wh-feeds-')));
	home = path.join(root, 'home');
	projects = path.join(root, 'projects');
	worktree = path.join(root, 'pool', '7', 'wheelhouse');
	mkdirSync(path.join(home, 'state'), { recursive: true });
	mkdirSync(worktree, { recursive: true });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('a worker’s record', () => {
	it('names its harness, worktree and spawn time', async () => {
		meta('tide', [
			'window=firstmate:fm-tide',
			`worktree=${worktree}`,
			'harness=claude',
			`spawn_gen=s${SPAWN}.85288.21791`
		]);
		expect(await workerMeta(home, 'tide')).toEqual({
			harness: 'claude',
			worktree,
			spawnedAt: SPAWN * 1000
		});
		meta('bare', ['window=firstmate:fm-bare']);
		expect(await workerMeta(home, 'bare')).toEqual({
			harness: 'claude',
			worktree: null,
			spawnedAt: null
		});
		expect(await workerMeta(home, 'gone')).toBeNull();
		expect(await workerMeta(home, '../etc')).toBeNull();
	});
});

describe('finding a worker’s transcript', () => {
	it('is the newest one for its worktree written since it was spawned', async () => {
		transcript('older-task', worktree, SPAWN - 86_400);
		const now = transcript('this-task', worktree, SPAWN + 60);
		transcript('elsewhere', path.join(root, 'other'), SPAWN + 120);
		expect(
			await locateWorkerTranscript({ projectsDir: projects, worktree, spawnedAt: SPAWN * 1000 })
		).toBe(now);
	});

	it('is none when only an earlier task’s session used the worktree', async () => {
		transcript('older-task', worktree, SPAWN - 86_400);
		expect(
			await locateWorkerTranscript({ projectsDir: projects, worktree, spawnedAt: SPAWN * 1000 })
		).toBeNull();
	});

	it('skips a file in the folder whose records name another directory', async () => {
		const other = transcript('stray', path.join(root, 'pool', '7', 'wheelhouse'), SPAWN + 10);
		const wrong = path.join(path.dirname(other), 'wrong.jsonl');
		writeFileSync(wrong, JSON.stringify({ type: 'system', cwd: '/somewhere/else' }) + '\n');
		utimesSync(wrong, SPAWN + 500, SPAWN + 500);
		expect(
			await locateWorkerTranscript({ projectsDir: projects, worktree, spawnedAt: SPAWN * 1000 })
		).toBe(other);
	});
});

describe('what a discussion says of the worker’s conversation', () => {
	it('reads a Claude Code worker’s, and says why it cannot read another', () => {
		const claude = { harness: 'claude', worktree, spawnedAt: null };
		expect(workerSession(claude, true, true)).toMatchObject({
			state: 'external',
			reason: null,
			harness: 'claude',
			busy: true,
			canSend: false
		});
		expect(workerSession({ ...claude, harness: 'codex' }, false, true)).toMatchObject({
			state: 'unavailable',
			harness: 'codex',
			reason: expect.stringContaining('this one runs Codex') as unknown as string
		});
		expect(workerSession(null, false, true).reason).toMatch(/no record of this worker/);
		expect(workerSession(claude, false, false).reason).toMatch(/cannot read Claude Code/);
		expect(workerSession({ ...claude, worktree: null }, false, true).reason).toMatch(
			/not recorded where/
		);
	});
});

describe('a worker’s feed', () => {
	it('streams its transcript as the chat streams Firstmate’s', async () => {
		meta('tide', [`worktree=${worktree}`, 'harness=claude', `spawn_gen=s${SPAWN}.1.2`]);
		transcript('this-task', worktree, Math.floor(Date.now() / 1000), [
			{
				type: 'assistant',
				uuid: 'a1',
				timestamp: '2026-11-15T10:00:00Z',
				message: { id: 'm1', role: 'assistant', content: [{ type: 'text', text: 'On it.' }] }
			}
		]);
		const feeds = new WorkerFeeds({
			homeDir: home,
			projectsDir: projects,
			busy: () => false,
			pollMs: 60_000
		});
		const events: FeedEvent[] = [];
		const synced = new Promise<void>((resolve) => {
			const stop = feeds.feed('tide').subscribe((e) => {
				events.push(e);
				if (e.type === 'synced') {
					stop();
					resolve();
				}
			});
		});
		await synced;
		expect(events.find((e) => e.type === 'session')).toMatchObject({
			data: { state: 'external' }
		});
		expect(events.find((e) => e.type === 'reset' && e.data)).toMatchObject({
			data: { how: 'worktree' }
		});
		const records = events.flatMap((e) => (e.type === 'records' ? e.data : []));
		expect(records.map((r) => r.uuid)).toEqual(['a1']);
		expect(feeds.feed('tide')).toBe(feeds.feed('tide'));
		feeds.stop();
	});

	it('lets go only of feeds no page listens to', async () => {
		const feeds = new WorkerFeeds({
			homeDir: home,
			projectsDir: projects,
			busy: () => false,
			pollMs: 60_000
		});
		const open = feeds.feed('open');
		const unsubscribe = open.subscribe(() => {});
		const idle = feeds.feed('idle');
		for (let i = 0; i < MAX_FEEDS * 2; i++) feeds.feed(`other-${i}`);
		expect(feeds.feed('open')).toBe(open);
		expect(feeds.feed('idle')).not.toBe(idle);
		unsubscribe();
		for (let i = 0; i < MAX_FEEDS; i++) feeds.feed(`more-${i}`);
		expect(feeds.feed('open')).not.toBe(open);
		feeds.stop();
	});
});
