import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdapterResult } from './adapter';
import type { InboxNoteResult as Note } from './contracts';
import { MateTasks, mateTaskId, parseMateTaskId, parseStatusLog } from './matetasks';
import type { MateTask, SecondMate } from '../../types';

const task = (id: string, o: Partial<MateTask> = {}): MateTask => ({
	id,
	title: `Task ${id}`,
	projectId: 'lumen',
	status: 'working',
	statusLabel: 'Working',
	doing: null,
	since: null,
	completedOn: null,
	pr: null,
	report: null,
	...o
});

const mate = (o: Partial<SecondMate>): SecondMate =>
	({
		id: 'tokyo',
		where: 'remote',
		host: 'tokyo-box',
		home: '/home/fm/tokyo',
		inFlight: [task('tk-1')],
		queued: [],
		landed: [task('tk-old', { status: 'landed', statusLabel: 'Landed' })],
		peek: { available: true, reason: null },
		...o
	}) as SecondMate;

const LOG = [
	'working [at=1793000000]: building the share API',
	'note [at=1793000060]: preview http://127.0.0.1:5173/share',
	'done [at=1793000120]: PR https://github.com/o/lumen/pull/42 checks green',
	'garbage line without a colon'
].join('\n');

const note = (outcome: 'created' | 'replay' = 'created'): AdapterResult<Note> => ({
	ok: true,
	value: {
		schema: 'fm-inbox-note.v1',
		outcome,
		noteId: 'n1',
		requestId: 'wh-1',
		saved: true,
		announced: true,
		acknowledged: false
	},
	observedAt: 'x',
	durationMs: 1
});

let home: string;
beforeEach(() => {
	home = mkdtempSync(path.join(tmpdir(), 'wh-mate-home-'));
	mkdirSync(path.join(home, 'state'));
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

function make(mates: SecondMate[]) {
	const adapter = {
		remoteFile: vi.fn(async (): Promise<AdapterResult<string>> => ({
			ok: true,
			value: LOG,
			observedAt: '2026-10-11T05:00:00Z',
			durationMs: 1
		})),
		matePeekTask: vi.fn(),
		mateNote: vi.fn(async (): Promise<AdapterResult<Note>> => note())
	};
	const forwards = {
		open: vi.fn(async () => ({ ok: true as const, port: 41000 })),
		retain: vi.fn()
	};
	const check = vi.fn(
		async (p: { url: string; reportedAt: string } | null) =>
			({
				url: p?.url ?? null,
				reportedAt: p?.reportedAt ?? null,
				state: p ? 'live' : 'none',
				reason: null,
				checkedAt: 'x'
			}) as const
	);
	const tasks = new MateTasks({ adapter, mates: () => mates, forwards, check, now: () => 1_000 });
	return { tasks, adapter, forwards, check };
}

describe('a second mate’s task id', () => {
	it('is <task>@<mate>, which no task of the captain’s can be', () => {
		expect(mateTaskId('tokyo', 'tk-1')).toBe('tk-1@tokyo');
		expect(parseMateTaskId('tk-1@tokyo')).toEqual({ mate: 'tokyo', task: 'tk-1' });
		for (const bad of ['tk-1', '@tokyo', 'tk-1@', 'a b@tokyo', 'tk-1@-x', '../x@tokyo']) {
			expect(parseMateTaskId(bad)).toBeNull();
		}
	});
});

describe('a second mate’s task status log', () => {
	it('gives its history, latest preview and pull request', () => {
		const log = parseStatusLog(LOG);
		expect(log.lines.map((l) => l.state)).toEqual(['working', 'note', 'done']);
		expect(log.preview).toEqual({
			url: 'http://127.0.0.1:5173/share',
			reportedAt: new Date(1793000060 * 1000).toISOString()
		});
		expect(log.pr).toBe('https://github.com/o/lumen/pull/42');
	});
});

describe('a remote second mate’s task', () => {
	it('reads its status log on its host, at most every 10 s, and keeps its PR and preview', async () => {
		const { tasks, adapter } = make([mate({})]);
		const log = await tasks.log('tk-1@tokyo');
		expect(log.ok && log.value.pr).toBe('https://github.com/o/lumen/pull/42');
		expect(log.ok && log.value.preview?.url).toBe('http://127.0.0.1:5173/share');
		expect(tasks.facts('tk-1@tokyo')).toEqual({
			pr: 'https://github.com/o/lumen/pull/42',
			preview: { url: 'http://127.0.0.1:5173/share', reportedAt: expect.any(String) }
		});
		await tasks.log('tk-1@tokyo');
		expect(adapter.remoteFile).toHaveBeenCalledTimes(1);
		expect(adapter.remoteFile).toHaveBeenCalledWith('tokyo', 'state/tk-1.status', 262144);
	});

	it('shows its preview here through a forward of only the reported port', async () => {
		const { tasks, forwards, check } = make([mate({})]);
		const c = await tasks.preview('tk-1@tokyo', 'http://127.0.0.1:4310');
		expect(forwards.open).toHaveBeenCalledWith('tokyo-box', 5173);
		expect(c.url).toBe('http://127.0.0.1:41000/share');
		expect(check).toHaveBeenCalledWith(
			{ url: 'http://127.0.0.1:41000/share', reportedAt: expect.any(String) },
			'http://127.0.0.1:4310',
			{ landed: false }
		);
		tasks.retain();
		expect(forwards.retain).toHaveBeenLastCalledWith(new Set(['tokyo-box:5173']));
	});

	it('never forwards a preview that is not on its host’s loopback', async () => {
		const { tasks, adapter, forwards } = make([mate({})]);
		adapter.remoteFile.mockResolvedValueOnce({
			ok: true,
			value: 'note: preview https://evil.example/x',
			observedAt: 'x',
			durationMs: 1
		});
		const c = await tasks.preview('tk-1@tokyo', 'http://127.0.0.1:4310');
		expect(c.state).toBe('refused');
		expect(forwards.open).not.toHaveBeenCalled();
	});

	it('reads as offline when its host cannot be reached (exit 255)', async () => {
		const { tasks, adapter } = make([mate({})]);
		adapter.remoteFile.mockResolvedValueOnce({
			ok: false,
			observedAt: 'x',
			error: { kind: 'exit', script: 'fm-on.sh', message: 'exit 255', exitCode: 255 }
		});
		const c = await tasks.preview('tk-1@tokyo', 'o');
		expect(c.state).toBe('down');
		expect(c.reason).toContain('could not reach tokyo-box');
		adapter.matePeekTask.mockResolvedValueOnce({
			ok: false,
			observedAt: 'x',
			error: { kind: 'exit', script: 'fm-on.sh', message: 'exit 255', exitCode: 255 }
		});
		const out = await tasks.output('tk-1@tokyo', 40);
		expect(out).toMatchObject({ available: false });
		expect(out.reason).toContain('could not reach tokyo-box');
	});

	it('sends feedback to its own second mate about it, under the id that home knows', async () => {
		const { tasks, adapter } = make([mate({})]);
		const r = await tasks.send(
			'tk-1@tokyo',
			'wh-1',
			'Preview feedback for tk-1@tokyo (Task tk-1), sent together:\n1. Bigger button'
		);
		expect(r).toEqual({ ok: true, created: true, announced: true });
		expect(adapter.mateNote).toHaveBeenCalledWith(
			{ id: 'tokyo', remote: true },
			'wh-1',
			'Re: tk-1\nPreview feedback for tk-1 (Task tk-1), sent together:\n1. Bigger button'
		);
	});

	it('does not resend feedback its host may not have had', async () => {
		const { tasks, adapter } = make([mate({})]);
		adapter.mateNote.mockResolvedValueOnce({
			ok: false,
			observedAt: 'x',
			error: { kind: 'exit', script: 'fm-on.sh', message: 'exit 255', exitCode: 255 }
		});
		const r = await tasks.send('tk-1@tokyo', 'wh-1', 'hi');
		expect(r).toMatchObject({ ok: false, status: 502 });
		expect(adapter.mateNote).toHaveBeenCalledTimes(1);
	});

	it('is refused for a task its second mate does not list', async () => {
		const { tasks, adapter } = make([mate({})]);
		expect(tasks.find('tk-9@tokyo')).toMatchObject({ ok: false, status: 404 });
		expect(await tasks.send('tk-9@tokyo', 'wh-1', 'hi')).toMatchObject({ ok: false, status: 404 });
		expect(adapter.mateNote).not.toHaveBeenCalled();
	});
});

describe('a local second mate’s task', () => {
	it('reads its status log in that home and shows its preview as it is', async () => {
		writeFileSync(path.join(home, 'state', 'os-1.status'), LOG);
		const local = mate({
			id: 'osaka',
			where: 'local',
			host: null,
			home,
			inFlight: [task('os-1')]
		});
		const { tasks, adapter, forwards } = make([local]);
		const c = await tasks.preview('os-1@osaka', 'o');
		expect(c.url).toBe('http://127.0.0.1:5173/share');
		expect(forwards.open).not.toHaveBeenCalled();
		expect(adapter.remoteFile).not.toHaveBeenCalled();
		await tasks.send('os-1@osaka', 'wh-2', 'hi');
		expect(adapter.mateNote).toHaveBeenCalledWith(
			{ id: 'osaka', remote: false, home },
			'wh-2',
			'Re: os-1\nhi'
		);
	});
});
