import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parseSmapsRollup, parseVmmapFootprint, sampleProcess } from './process';
import { crewTaskOf, describeHeavy, parsePs, programName } from './heavy';
import { folderBytes, handledNotes, measureHistory } from './history';
import {
	median,
	openStreams,
	recordRemoteRead,
	remoteReadP50,
	resetCounters,
	sseOpened,
	trackedFeeds,
	trackFeed,
	uploadStarted,
	uploadsInProgress
} from './counters';

afterEach(() => resetCounters());

describe('process probe', () => {
	it('reads the Linux footprint as private dirty memory plus swap', () => {
		const text =
			'Rss:  204800 kB\nPss:  150000 kB\nPrivate_Clean: 1000 kB\nPrivate_Dirty:   102400 kB\nSwapPss:  2048 kB\n';
		expect(parseSmapsRollup(text)).toBe((102400 + 2048) * 1024);
		expect(parseSmapsRollup('nothing here')).toBeNull();
	});

	it('reads the macOS physical footprint from vmmap -summary', () => {
		const text =
			'Process: node [123]\nPhysical footprint:         212.5M\nPhysical footprint (peak):  300M\n';
		expect(parseVmmapFootprint(text)).toBe(Math.round(212.5 * 1024 * 1024));
		expect(parseVmmapFootprint('Physical footprint:  1.5G')).toBe(Math.round(1.5 * 1024 ** 3));
		expect(parseVmmapFootprint('')).toBeNull();
	});

	it('samples this process and counts the child processes it starts', async () => {
		const before = await sampleProcess();
		await promisify(execFile)('true');
		await promisify(execFile)('true');
		const after = await sampleProcess();
		expect(after.spawnsTotal - before.spawnsTotal).toBeGreaterThanOrEqual(2);
		expect(after.spawnsPerMinute).toBeGreaterThanOrEqual(2);
		expect(after.rssMb).toBeGreaterThan(0);
		expect(after.load.cpus).toBeGreaterThan(0);
		expect(after.eventLoop.p99Ms).toBeGreaterThanOrEqual(0);
	});
});

describe('heaviest processes', () => {
	it('parses ps and sorts the heaviest first', () => {
		const rows = parsePs(
			'  12  3.5 /usr/bin/zsh\n 40 97.0 node /srv/app.js --x\n\n 7 0.0 [kthreadd]\n'
		);
		expect(rows.map((r) => r.pid)).toEqual([40, 12, 7]);
		expect(rows[0].command).toBe('node /srv/app.js --x');
	});

	it('names the crew task by working directory, command line or task id', () => {
		const crew = [
			{ taskId: 'fix-login', worktree: '/work/pool/1/app' },
			{ taskId: 'add-search', worktree: '/work/pool/2/app/' }
		];
		const row = (command: string) => ({ pid: 1, cpu: 50, command });
		expect(crewTaskOf(row('claude'), '/work/pool/1/app/src', crew)).toBe('fix-login');
		expect(crewTaskOf(row('vitest --root /work/pool/2/app'), null, crew)).toBe('add-search');
		expect(crewTaskOf(row('tmux new -s fm-add-search'), null, crew)).toBe('add-search');
		expect(crewTaskOf(row('claude'), '/work/pool/10/app', crew)).toBeNull();
	});

	it('describes crew processes first', () => {
		expect(programName('/usr/local/bin/node --inspect x.js')).toBe('node');
		expect(
			describeHeavy([
				{ pid: 1, cpu: 150.4, command: '/usr/bin/node a.js', taskId: null },
				{ pid: 2, cpu: 60, command: 'claude', taskId: 'fix-login' },
				{ pid: 3, cpu: 40, command: 'git status', taskId: null },
				{ pid: 4, cpu: 30, command: 'rg x', taskId: null }
			])
		).toBe('claude (fix-login) 60%, node 150%, git 40%');
	});
});

describe('history sizes', () => {
	let dir = '';
	afterEach(async () => {
		if (dir) await rm(dir, { recursive: true, force: true });
		dir = '';
	});

	it('measures data/, handled notes and the chat archive without changing them', async () => {
		dir = await mkdtemp(path.join(tmpdir(), 'wh-health-'));
		const home = path.join(dir, 'home');
		await mkdir(path.join(home, 'data', 'task-a'), { recursive: true });
		await writeFile(path.join(home, 'data', 'task-a', 'log'), 'x'.repeat(1000));
		await writeFile(path.join(home, 'data', 'top'), 'y'.repeat(24));
		await mkdir(path.join(home, 'state', 'inbox', 'handled'), { recursive: true });
		await mkdir(path.join(home, 'state', 'fix-login.inbox', 'handled'), { recursive: true });
		for (const n of ['1.note', '2.note'])
			await writeFile(path.join(home, 'state', 'inbox', 'handled', n), 'n');
		await writeFile(path.join(home, 'state', 'fix-login.inbox', 'handled', '9.msg'), 'm');
		const archive = path.join(dir, 'chat-archive');
		await mkdir(archive);
		await writeFile(path.join(archive, 's.jsonl'), 'z'.repeat(10));

		expect(await folderBytes(path.join(home, 'data'))).toBe(1024);
		expect(await folderBytes(path.join(dir, 'missing'))).toBeNull();
		expect(await handledNotes(home)).toBe(3);
		expect(
			await measureHistory({
				homeDir: home,
				dataDir: path.join(home, 'data'),
				chatArchiveDir: archive
			})
		).toEqual({ dataBytes: 1024, handledNotes: 3, chatArchiveBytes: 10 });
	});
});

describe('counters', () => {
	it('counts open streams and uploads, each closed once', () => {
		const a = sseOpened();
		const b = sseOpened();
		expect(openStreams()).toBe(2);
		a();
		a();
		expect(openStreams()).toBe(1);
		b();
		expect(openStreams()).toBe(0);
		const u = uploadStarted();
		expect(uploadsInProgress()).toBe(1);
		u();
		expect(uploadsInProgress()).toBe(0);
	});

	it('tracks chat followers weakly', () => {
		const f = { listening: 0, watching: true, stop() {} };
		trackFeed(f);
		expect(trackedFeeds()).toEqual([f]);
	});

	it('takes the median of a remote mate’s recent reads, once there are three', () => {
		const now = Date.parse('2026-11-17T10:00:00Z');
		recordRemoteRead('tokyo', 5000, now);
		recordRemoteRead('tokyo', 1000, now);
		expect(remoteReadP50('tokyo', now)).toBeNull();
		recordRemoteRead('tokyo', 4000, now);
		expect(remoteReadP50('tokyo', now)).toBe(4000);
		// Old reads stop counting.
		expect(remoteReadP50('tokyo', now + 31 * 60_000)).toBeNull();
		expect(median([1, 2, 3, 4])).toBe(3);
	});
});
