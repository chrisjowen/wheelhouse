import {
	appendFileSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fold } from '../../chat/fold';
import { homeTranscripts, type TranscriptRecord } from '../sessions/transcript';
import { ChatArchive, dividerId, sessionKey } from './archive';
import { ArchiveSync } from './sync';

// Synthetic transcripts only, in a temporary directory.
let root: string;
let dir: string;

beforeEach(() => {
	root = realpathSync(mkdtempSync(path.join(tmpdir(), 'wh-archive-')));
	dir = path.join(root, 'state', 'chat-archive');
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const line = (r: TranscriptRecord) => `${JSON.stringify(r)}\n`;
let clock = Date.parse('2026-11-01T00:00:00Z');
const at = () => new Date((clock += 1000)).toISOString();
const captain = (uuid: string, text: string): TranscriptRecord => ({
	type: 'user',
	uuid,
	timestamp: at(),
	origin: { kind: 'human' },
	message: { role: 'user', content: text }
});
const reply = (uuid: string, text: string): TranscriptRecord => ({
	type: 'assistant',
	uuid,
	timestamp: at(),
	message: { id: `m-${uuid}`, role: 'assistant', content: [{ type: 'text', text }] }
});
const done = (uuid: string): TranscriptRecord => ({
	type: 'system',
	subtype: 'turn_duration',
	uuid,
	timestamp: at(),
	durationMs: 10
});
/** A captain's message, Firstmate's reply and the turn's end. */
const exchange = (n: string, ask: string, answer: string) => [
	captain(`${n}-q`, ask),
	reply(`${n}-a`, answer),
	done(`${n}-d`)
];

function transcript(name: string, records: TranscriptRecord[]): string {
	const file = path.join(root, 'projects', 'fm', `${name}.jsonl`);
	mkdirSync(path.dirname(file), { recursive: true });
	writeFileSync(file, records.map(line).join(''));
	return file;
}

const uuids = (rs: TranscriptRecord[]) => rs.map((r) => r.uuid);

describe('ChatArchive ingest', () => {
	it('keeps every shown record of a transcript and reads only what is new after', async () => {
		const file = transcript('aaaa', [
			{ type: 'mode', mode: 'x' },
			...exchange('1', 'hello', 'hi captain'),
			{ type: 'user', uuid: 'side', isSidechain: true, timestamp: at(), message: { content: 'x' } }
		]);
		const a = await ChatArchive.open(dir, root);
		expect(await a.ingestFile(file, 'claude')).toBe(3);
		expect(await a.ingestFile(file, 'claude')).toBe(0);
		// A line still being written is held back until it is whole.
		const more = exchange('2', 'and then?', 'then this');
		appendFileSync(file, line(more[0]) + line(more[1]).slice(0, 20));
		expect(await a.ingestFile(file, 'claude')).toBe(1);
		appendFileSync(file, line(more[1]).slice(20) + line(more[2]));
		expect(await a.ingestFile(file, 'claude')).toBe(2);
		const page = await a.page({});
		expect(uuids(page.records)).toEqual([
			dividerId('aaaa'),
			'1-q',
			'1-a',
			'1-d',
			'2-q',
			'2-a',
			'2-d'
		]);
		expect(page.more).toBe(false);
	});

	it('keeps a record once across sessions, as a resumed session repeats earlier ones', async () => {
		const first = exchange('1', 'one', 'uno');
		const a = await ChatArchive.open(dir, root);
		await a.ingestFile(transcript('aaaa', first), 'claude');
		await a.ingestFile(transcript('bbbb', [...first, ...exchange('2', 'two', 'dos')]), 'claude');
		const page = await a.page({});
		expect(uuids(page.records)).toEqual([
			dividerId('aaaa'),
			'1-q',
			'1-a',
			'1-d',
			dividerId('bbbb'),
			'2-q',
			'2-a',
			'2-d'
		]);
		expect(a.stats()).toMatchObject({ sessions: 2, records: 6 });
	});

	it('reads a rewritten (shorter) transcript again from its start, keeping what it had', async () => {
		const file = transcript('aaaa', [
			...exchange('1', 'one', 'uno'),
			...exchange('2', 'two', 'dos')
		]);
		const a = await ChatArchive.open(dir, root);
		await a.ingestFile(file, 'claude');
		writeFileSync(file, exchange('3', 'three', 'tres').map(line).join(''));
		expect(await a.ingestFile(file, 'claude')).toBe(3);
		expect(a.stats().records).toBe(9);
	});

	it('slims records as the chat does and keeps a conversation read whole once', async () => {
		const a = await ChatArchive.open(dir, root);
		const big = 'x'.repeat(20_000);
		const records = [
			captain('1', 'hello'),
			{
				type: 'user',
				uuid: '2',
				timestamp: at(),
				message: { content: [{ type: 'tool_result', tool_use_id: 't', content: big }] },
				toolUseResult: { stdout: big }
			}
		];
		expect(await a.ingestRecords('/pi/session.jsonl', 'pi', records)).toBe(2);
		expect(await a.ingestRecords('/pi/session.jsonl', 'pi', records)).toBe(0);
		const kept = (await a.page({})).records[2];
		expect(kept.toolUseResult).toBeUndefined();
		expect(kept.message.content[0].content.length).toBeLessThan(17_000);
	});

	it('names a session by its file, or by a hash of a path that cannot be a file name', () => {
		expect(sessionKey('/x/70cc964c-66f6.jsonl')).toBe('70cc964c-66f6');
		expect(sessionKey('/x/odd name!.jsonl')).toMatch(/^s-[0-9a-f]{16}$/);
	});
});

describe('ChatArchive across restarts', () => {
	it('reads back what it holds, and does not read a source again', async () => {
		const file = transcript('aaaa', exchange('1', 'hello', 'hi'));
		const a = await ChatArchive.open(dir, root);
		await a.ingestFile(file, 'claude');
		const b = await ChatArchive.open(dir, root);
		expect(uuids((await b.page({})).records)).toEqual([dividerId('aaaa'), '1-q', '1-a', '1-d']);
		expect(await b.ingestFile(file, 'claude')).toBe(0);
		expect(b.search('hello')).toHaveLength(1);
	});

	it('cuts a half-written last line, and keeps a session the index never recorded', async () => {
		const file = transcript('aaaa', exchange('1', 'hello', 'hi'));
		const a = await ChatArchive.open(dir, root);
		await a.ingestFile(file, 'claude');
		const sessions = path.join(dir, 'sessions');
		appendFileSync(path.join(sessions, 'aaaa.jsonl'), '{"type":"user","uu');
		writeFileSync(
			path.join(sessions, 'bbbb.jsonl'),
			line({ ...captain('2-q', 'later'), timestamp: '2026-12-01T00:00:00Z' })
		);
		const b = await ChatArchive.open(dir, root);
		expect(readFileSync(path.join(sessions, 'aaaa.jsonl'), 'utf8').endsWith('\n')).toBe(true);
		expect(uuids((await b.page({})).records)).toEqual([
			dividerId('aaaa'),
			'1-q',
			'1-a',
			'1-d',
			dividerId('bbbb'),
			'2-q'
		]);
		// The source was recorded as read, so nothing is taken in twice.
		expect(await b.ingestFile(file, 'claude')).toBe(0);
	});

	it('starts empty from a missing or foreign index', async () => {
		mkdirSync(dir, { recursive: true });
		writeFileSync(path.join(dir, 'index.json'), '{"schema":"something-else"}');
		const a = await ChatArchive.open(dir, root);
		expect(a.stats()).toMatchObject({ sessions: 0, records: 0, oldest: null });
		expect(await a.page({})).toEqual({ records: [], more: false });
	});
});

describe('ChatArchive pages', () => {
	async function archive() {
		const a = await ChatArchive.open(dir, root);
		await a.ingestFile(
			transcript(
				'aaaa',
				Array.from({ length: 5 }, (_, i) => exchange(`a${i}`, `ask ${i}`, `answer ${i}`)).flat()
			),
			'claude'
		);
		await a.ingestFile(
			transcript(
				'bbbb',
				Array.from({ length: 5 }, (_, i) => exchange(`b${i}`, `query ${i}`, `reply ${i}`)).flat()
			),
			'claude'
		);
		return a;
	}

	it('goes back from a record to the start of the turn it would cut', async () => {
		const a = await archive();
		const page = await a.page({ before: 'b3-q', limit: 2 });
		expect(uuids(page.records)).toEqual(['b2-q', 'b2-a', 'b2-d']);
		expect(page.more).toBe(true);
	});

	it('puts a session divider before its first record, crossing into the session before', async () => {
		const a = await archive();
		const page = await a.page({ before: 'b0-a', limit: 3 });
		expect(uuids(page.records)).toEqual(['a4-q', 'a4-a', 'a4-d', dividerId('bbbb'), 'b0-q']);
		// From a divider, the session before it.
		const earlier = await a.page({ before: dividerId('bbbb'), limit: 1 });
		expect(uuids(earlier.records)).toEqual(['a4-q', 'a4-a', 'a4-d']);
	});

	it('reaches the beginning with the first divider, and says nothing more remains', async () => {
		const a = await archive();
		const page = await a.page({ before: 'a1-q', limit: 100 });
		expect(uuids(page.records)).toEqual([dividerId('aaaa'), 'a0-q', 'a0-a', 'a0-d']);
		expect(page.more).toBe(false);
	});

	it('goes back to a record with `until`, however far', async () => {
		const a = await archive();
		const page = await a.page({ before: 'b4-q', until: 'a1-a', limit: 1 });
		expect(page.records[0].uuid).toBe('a1-q');
		expect(uuids(page.records)).toContain(dividerId('bbbb'));
		expect(page.records[page.records.length - 1].uuid).toBe('b3-d');
	});

	it('folds into a chat with a divider for each session', async () => {
		const a = await archive();
		const chat = fold((await a.page({ limit: 10_000 })).records);
		const sessions = chat.items.filter((it) => it.kind === 'session');
		expect(sessions.map((s) => s.id)).toEqual([dividerId('aaaa'), dividerId('bbbb')]);
		expect(sessions.map((s) => (s.kind === 'session' ? s.first : null))).toEqual([true, false]);
		expect(chat.items.filter((it) => it.kind === 'user')).toHaveLength(10);
	});
});

describe('ChatArchive search', () => {
	it('finds the captain’s messages and Firstmate’s replies holding every word, newest first', async () => {
		const a = await ChatArchive.open(dir, root);
		await a.ingestFile(
			transcript('aaaa', [
				...exchange('1', 'Deploy the Fleetyard bridge', 'The bridge is deployed.'),
				...exchange('2', 'what about the docket?', 'Docket is next after the BRIDGE.'),
				{
					type: 'user',
					uuid: 'wake',
					timestamp: at(),
					origin: { kind: 'task-notification' },
					message: { content: '<task-notification>bridge</task-notification>' }
				}
			]),
			'claude'
		);
		const hits = a.search('bridge');
		expect(hits.map((h) => [h.uuid, h.who, h.bubble])).toEqual([
			['2-a', 'firstmate', '2-a-t'],
			['1-a', 'firstmate', '1-a-t'],
			['1-q', 'captain', '1-q']
		]);
		expect(a.search('docket bridge').map((h) => h.uuid)).toEqual(['2-a']);
		expect(a.search('  ')).toEqual([]);
		expect(hits[0].snippet).toContain('BRIDGE');
	});
});

describe('ChatArchive retention', () => {
	it('keeps everything by default, and deletes sessions that ended before a set retention', async () => {
		const a = await ChatArchive.open(dir, root);
		clock = Date.parse('2026-01-01T00:00:00Z');
		await a.ingestFile(transcript('old', exchange('o', 'old', 'old')), 'claude');
		clock = Date.parse('2026-11-01T00:00:00Z');
		await a.ingestFile(transcript('new', exchange('n', 'new', 'new')), 'claude');
		const now = Date.parse('2026-11-15T00:00:00Z');
		expect(await a.prune(now)).toBe(0);
		expect(a.stats().retentionDays).toBeNull();
		const stats = await a.setRetention(90, now);
		expect(stats).toMatchObject({ sessions: 1, records: 3, retentionDays: 90 });
		expect(a.search('old')).toEqual([]);
		// The setting and the deletion last, and the old transcript is not taken in again.
		const b = await ChatArchive.open(dir, root);
		expect(b.stats()).toMatchObject({ sessions: 1, retentionDays: 90 });
		expect(await b.ingestFile(path.join(root, 'projects', 'fm', 'old.jsonl'), 'claude')).toBe(0);
	});

	it('always keeps the newest session', async () => {
		const a = await ChatArchive.open(dir, root);
		clock = Date.parse('2026-01-01T00:00:00Z');
		await a.ingestFile(transcript('only', exchange('o', 'old', 'old')), 'claude');
		expect((await a.setRetention(30, Date.parse('2026-11-15T00:00:00Z'))).sessions).toBe(1);
	});

	it('refuses a retention that is not one of the choices', async () => {
		const a = await ChatArchive.open(dir, root);
		await expect(a.setRetention(7 as never)).rejects.toThrow();
	});
});

describe('backfill', () => {
	function claude(folder: string, id: string, cwd: string, entrypoint: string) {
		const file = path.join(root, 'claude', folder, `${id}.jsonl`);
		mkdirSync(path.dirname(file), { recursive: true });
		writeFileSync(
			file,
			[{ ...captain(`${id}-q`, `hello from ${id}`), cwd, entrypoint }].map(line).join('')
		);
		return file;
	}

	it('finds the home’s interactive sessions, leaving out helpers and other checkouts', async () => {
		const fm = path.join(root, 'firstmate');
		mkdirSync(fm, { recursive: true });
		const main = claude('fm', 'main', fm, 'cli');
		claude('fm', 'helper', fm, 'sdk-cli');
		claude('other', 'elsewhere', path.join(root, 'other'), 'cli');
		const known = new Map<string, boolean>();
		const o = { firstmateDir: fm, projectsDir: path.join(root, 'claude') };
		expect(await homeTranscripts(o, known)).toEqual([main]);
		// A later session in the same folder is found; the other folder is not read again.
		const next = claude('fm', 'next', fm, 'cli');
		expect(await homeTranscripts(o, known)).toEqual([main, next]);
	});

	it('takes in every transcript the first time, and what grew after', async () => {
		const fm = path.join(root, 'firstmate');
		mkdirSync(fm, { recursive: true });
		const one = claude('fm', 'one', fm, 'cli');
		const two = claude('fm', 'two', fm, 'cli');
		const a = await ChatArchive.open(dir, root);
		const sync = new ArchiveSync({
			archive: a,
			discover: () => homeTranscripts({ firstmateDir: fm, projectsDir: path.join(root, 'claude') })
		});
		await sync.discover();
		expect(a.stats().records).toBe(2);
		appendFileSync(two, line(reply('two-a', 'answer')));
		await sync.discover();
		expect(a.search('answer').map((h) => h.uuid)).toEqual(['two-a']);
		expect(one).toBeTruthy();
	});

	it('logs a failure to save once, and carries on', async () => {
		const logs: string[] = [];
		const a = await ChatArchive.open(dir, root);
		// The archive's folder is a file: nothing can be written.
		mkdirSync(path.dirname(dir), { recursive: true });
		writeFileSync(dir, 'not a folder');
		const sync = new ArchiveSync({
			archive: a,
			discover: async () => [transcript('aaaa', exchange('1', 'a', 'b'))],
			log: (m) => logs.push(m)
		});
		await sync.discover();
		await sync.discover();
		expect(logs).toHaveLength(1);
		expect(logs[0]).toMatch(/Chat archive: could not save/);
	});
});
