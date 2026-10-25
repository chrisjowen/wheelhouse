import {
	appendFileSync,
	mkdirSync,
	mkdtempSync,
	realpathSync,
	rmSync,
	utimesSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FirstmateSessionView } from '../../types';
import {
	ChatFeed,
	locateTranscript,
	MAX_RESULT_CHARS,
	slim,
	type FeedEvent,
	type LocateOptions,
	type TranscriptRecord
} from './transcript';

// Synthetic transcripts only: a temporary projects directory with made-up records.
let root: string;
let o: LocateOptions;
const ID_A = '11111111-1111-4111-8111-111111111111';
const ID_B = '22222222-2222-4222-8222-222222222222';

const line = (r: TranscriptRecord) => `${JSON.stringify(r)}\n`;
const rec = (uuid: string, cwd: string, extra: TranscriptRecord = {}) => ({
	type: 'user',
	uuid,
	cwd,
	timestamp: '2026-01-01T00:00:00Z',
	message: { role: 'user', content: `hello ${uuid}` },
	...extra
});

function transcript(folder: string, id: string, cwd: string, mtime = Date.now() / 1000): string {
	const dir = path.join(o.projectsDir, folder);
	mkdirSync(dir, { recursive: true });
	const file = path.join(dir, `${id}.jsonl`);
	writeFileSync(file, line({ type: 'mode', mode: 'x' }) + line(rec('u1', cwd)));
	utimesSync(file, mtime, mtime);
	return file;
}

beforeEach(() => {
	root = realpathSync(mkdtempSync(path.join(tmpdir(), 'wh-transcript-')));
	o = {
		firstmateDir: path.join(root, 'firstmate'),
		homeDir: path.join(root, 'firstmate'),
		hookFile: path.join(root, 'state', 'firstmate', 'session-start.json'),
		projectsDir: path.join(root, 'claude', 'projects')
	};
	mkdirSync(path.join(o.firstmateDir, 'state'), { recursive: true });
	mkdirSync(path.dirname(o.hookFile), { recursive: true });
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('locateTranscript', () => {
	it('follows the file Wheelhouse’s SessionStart hook recorded for its own session', async () => {
		const file = transcript('any-name', ID_A, o.firstmateDir);
		writeFileSync(
			o.hookFile,
			JSON.stringify({ session_id: ID_A, transcript_path: file, cwd: o.firstmateDir })
		);
		expect(await locateTranscript(o, 'ours')).toEqual({ how: 'hook', file });
	});

	it('ignores a hook record for another directory or a file outside the projects directory', async () => {
		const file = transcript('x', ID_A, o.firstmateDir);
		writeFileSync(
			o.hookFile,
			JSON.stringify({ session_id: ID_A, transcript_path: file, cwd: root })
		);
		expect((await locateTranscript(o, 'ours'))?.how).toBe('newest');
		const outside = path.join(root, 'elsewhere.jsonl');
		writeFileSync(outside, '');
		writeFileSync(
			o.hookFile,
			JSON.stringify({ session_id: ID_A, transcript_path: outside, cwd: o.firstmateDir })
		);
		expect((await locateTranscript(o, 'ours'))?.file).toBe(file);
	});

	it('finds a session started elsewhere by the id beside Firstmate’s lock', async () => {
		const lockFile = transcript('folder-one', ID_B, o.firstmateDir, 1000);
		transcript('folder-two', ID_A, o.firstmateDir, 2000);
		writeFileSync(path.join(o.homeDir, 'state', '.lock-session'), `${ID_B}\n`);
		// A stale hook record from an earlier Wheelhouse session is not trusted for it.
		writeFileSync(
			o.hookFile,
			JSON.stringify({
				session_id: ID_A,
				transcript_path: path.join(o.projectsDir, 'folder-two', `${ID_A}.jsonl`),
				cwd: o.firstmateDir
			})
		);
		expect(await locateTranscript(o, 'external')).toEqual({ how: 'lock', file: lockFile });
	});

	it('falls back to the newest transcript whose records name Firstmate’s checkout', async () => {
		transcript('older', ID_A, o.firstmateDir, 1000);
		const newest = transcript('newer', ID_B, o.firstmateDir, 2000);
		transcript('other-project', '33333333-3333-4333-8333-333333333333', root, 3000);
		writeFileSync(path.join(o.homeDir, 'state', '.lock-session'), 'not-a-uuid\n');
		expect(await locateTranscript(o, 'none')).toEqual({ how: 'newest', file: newest });
	});

	it('finds nothing when there is no transcript for the checkout', async () => {
		transcript('other', ID_A, root);
		expect(await locateTranscript(o, 'none')).toBeNull();
	});
});

describe('slim', () => {
	it('keeps what the chat reads and drops the rest', () => {
		const r = slim({
			type: 'assistant',
			uuid: 'a',
			timestamp: 't',
			requestId: 'drop',
			message: {
				id: 'm',
				role: 'assistant',
				usage: { input_tokens: 1 },
				content: [{ type: 'text', text: 'hi' }]
			}
		});
		expect(r).toEqual({
			type: 'assistant',
			uuid: 'a',
			timestamp: 't',
			message: { id: 'm', role: 'assistant', content: [{ type: 'text', text: 'hi' }] }
		});
	});

	it('cuts long tool output and keeps question answers', () => {
		const r = slim({
			type: 'user',
			uuid: 'u',
			timestamp: 't',
			toolUseResult: { answers: { 'Q?': 'A' }, stdout: 'big' },
			message: {
				role: 'user',
				content: [
					{ type: 'tool_result', tool_use_id: 'x', content: 'y'.repeat(MAX_RESULT_CHARS + 50) }
				]
			}
		});
		expect(r?.toolUseResult).toEqual({ answers: { 'Q?': 'A' } });
		const c = r?.message.content[0].content as string;
		expect(c.length).toBeLessThan(MAX_RESULT_CHARS + 100);
		expect(c).toMatch(/50 more characters/);
	});

	it('drops records and attachments the chat never shows', () => {
		expect(slim({ type: 'file-history-snapshot' })).toBeNull();
		expect(slim({ type: 'attachment', attachment: { type: 'total_tokens_reminder' } })).toBeNull();
		expect(slim({ type: 'system', subtype: 'stop_hook_summary' })).toBeNull();
		expect(
			slim({ type: 'attachment', uuid: 'q', attachment: { type: 'queued_command', prompt: 'p' } })
		).toMatchObject({
			attachment: { type: 'queued_command', prompt: 'p' }
		});
	});
});

describe('ChatFeed', () => {
	const view = (state: FirstmateSessionView['state']): FirstmateSessionView => ({
		schema: 'wheelhouse-firstmate-session.v1',
		state,
		reason: null,
		canSend: state === 'ours',
		attach: null,
		skipPermissions: true,
		picker: null,
		busy: false
	});

	let file: string | null;
	let events: FeedEvent[];
	let feed: ChatFeed;
	let unsubscribe: () => void;

	beforeEach(() => {
		file = null;
		events = [];
		feed = new ChatFeed({
			status: async () => view('ours'),
			locate: async () => (file ? { how: 'hook', file } : null),
			pollMs: 60_000,
			initialBytes: 400
		});
	});

	afterEach(() => unsubscribe?.());

	const records = () => events.flatMap((e) => (e.type === 'records' ? e.data : []));

	it('reads the transcript, then each complete line as it is appended', async () => {
		file = path.join(root, 'a.jsonl');
		writeFileSync(file, line(rec('u1', '/x')));
		unsubscribe = feed.subscribe((e) => events.push(e));
		await feed.refresh();
		expect(events.find((e) => e.type === 'session')).toBeTruthy();
		expect(records().map((r) => r.uuid)).toEqual(['u1']);

		const second = line(rec('u2', '/x'));
		appendFileSync(file, second.slice(0, 20));
		await feed.refresh();
		expect(records().map((r) => r.uuid)).toEqual(['u1']);
		appendFileSync(file, second.slice(20));
		await feed.refresh();
		expect(records().map((r) => r.uuid)).toEqual(['u1', 'u2']);
		expect(feed.snapshot().map((r) => r.uuid)).toEqual(['u1', 'u2']);
	});

	it('keeps a character split across two reads whole', async () => {
		file = path.join(root, 'a.jsonl');
		writeFileSync(file, '');
		unsubscribe = feed.subscribe((e) => events.push(e));
		await feed.refresh();
		const bytes = Buffer.from(
			line(rec('u1', '/x', { message: { role: 'user', content: 'ship ⚓ ’' } }))
		);
		const cut = bytes.indexOf(Buffer.from('⚓')) + 1;
		appendFileSync(file, bytes.subarray(0, cut));
		await feed.refresh();
		appendFileSync(file, bytes.subarray(cut));
		await feed.refresh();
		expect(records().map((r) => r.message?.content)).toEqual(['ship ⚓ ’']);
	});

	it('pushes appended lines again after the last page left and a new one connects', async () => {
		file = path.join(root, 'a.jsonl');
		writeFileSync(file, line(rec('u1', '/x')));
		unsubscribe = feed.subscribe(() => {});
		await feed.refresh();
		unsubscribe();
		unsubscribe = feed.subscribe((e) => events.push(e));
		await feed.refresh();
		appendFileSync(file, line(rec('u2', '/x')));
		await vi.waitFor(
			() => {
				const pushed = events.filter((e) => e.type === 'records').pop();
				expect(pushed?.type === 'records' && pushed.data.map((r) => r.uuid)).toEqual(['u2']);
			},
			{ timeout: 3000 }
		);
	});

	it('starts over when the session moves to a new transcript', async () => {
		file = path.join(root, 'a.jsonl');
		writeFileSync(file, line(rec('u1', '/x')));
		unsubscribe = feed.subscribe((e) => events.push(e));
		await feed.refresh();
		file = path.join(root, 'b.jsonl');
		writeFileSync(file, line(rec('v1', '/x')));
		events = [];
		await feed.refresh();
		expect(events.map((e) => e.type)).toEqual(['reset', 'records']);
		expect(feed.snapshot().map((r) => r.uuid)).toEqual(['v1']);
	});

	it('reads only the end of a large file and says earlier records were left out', async () => {
		file = path.join(root, 'big.jsonl');
		writeFileSync(file, Array.from({ length: 10 }, (_, i) => line(rec(`u${i}`, '/x'))).join(''));
		unsubscribe = feed.subscribe((e) => events.push(e));
		await feed.refresh();
		const reset = events.filter((e) => e.type === 'reset').pop();
		expect(reset?.data).toMatchObject({ truncated: true });
		const got = feed.snapshot().map((r) => r.uuid);
		expect(got.length).toBeGreaterThan(0);
		expect(got.length).toBeLessThan(10);
		expect(got[got.length - 1]).toBe('u9');
	});

	it('gives a page that connects later what it already holds', async () => {
		file = path.join(root, 'a.jsonl');
		writeFileSync(file, line(rec('u1', '/x')));
		unsubscribe = feed.subscribe(() => {});
		await feed.refresh();
		const late: FeedEvent[] = [];
		const off = feed.subscribe((e) => late.push(e));
		expect(late.map((e) => e.type)).toEqual(['session', 'reset', 'records']);
		off();
	});
});
