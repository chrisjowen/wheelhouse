import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ANSWERED_SCHEMA, AnsweredLog, answeredFileFor, type AnsweredRecord } from './answered';

let dir: string;
let file: string;
beforeEach(() => {
	dir = mkdtempSync(path.join(tmpdir(), 'wh-answered-'));
	file = path.join(dir, 'answered-decisions.json');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const rec = (n: number, over: Partial<AnsweredRecord> = {}): AnsweredRecord => ({
	requestId: `inbox-${n}`,
	cardId: `demo-task:key-${n}`,
	taskId: 'demo-task',
	taskTitle: 'Demo task',
	projectId: 'demo',
	kind: 'decision',
	key: `key-${n}`,
	question: `Question ${n}?`,
	askedAt: '2026-10-31T09:00:00.000Z',
	choice: 'approve',
	label: 'Approve',
	picks: null,
	note: null,
	answeredAt: '2026-10-31T09:05:00.000Z',
	...over
});

describe('AnsweredLog', () => {
	it('lives beside the message store, one per Firstmate home', () => {
		expect(answeredFileFor('/state', '/home/a')).toMatch(
			/^\/state\/homes\/[0-9a-f]{16}\/answered-decisions\.json$/
		);
		expect(answeredFileFor('/state', '/home/a')).not.toBe(answeredFileFor('/state', '/home/b'));
	});

	it('keeps each answer once, saves it, and reads it back', async () => {
		const log = await AnsweredLog.open(file, '/home/a');
		expect(log.list()).toEqual([]);
		await log.record(rec(1, { picks: 'Layout: B', note: 'Ship it.' }));
		await log.record(rec(1, { note: 'A repeat changes nothing.' }));
		await log.record(rec(2, { choice: 'close', label: 'Close' }));
		const doc = JSON.parse(readFileSync(file, 'utf8'));
		expect(doc).toMatchObject({ schema: ANSWERED_SCHEMA, home: '/home/a' });
		const again = await AnsweredLog.open(file, '/home/a');
		expect(again.list()).toEqual([
			rec(1, { picks: 'Layout: B', note: 'Ship it.' }),
			rec(2, { choice: 'close', label: 'Close' })
		]);
	});

	it('forgets the oldest answers beyond its cap', async () => {
		const log = await AnsweredLog.open(file, '/home/a', 2);
		for (const n of [1, 2, 3]) await log.record(rec(n));
		expect(log.list().map((r) => r.requestId)).toEqual(['inbox-2', 'inbox-3']);
	});

	it('skips records it cannot read, and starts empty from a missing or broken file', async () => {
		writeFileSync(
			file,
			JSON.stringify({
				schema: ANSWERED_SCHEMA,
				answered: [
					rec(1),
					{ ...rec(2), kind: 'nonsense' },
					{ ...rec(3), choice: 'merge' },
					'x',
					null
				]
			})
		);
		expect((await AnsweredLog.open(file, '/home/a')).list().map((r) => r.requestId)).toEqual([
			'inbox-1'
		]);
		writeFileSync(file, '{ not json');
		expect((await AnsweredLog.open(file, '/home/a')).list()).toEqual([]);
		expect((await AnsweredLog.open(path.join(dir, 'none.json'), '/home/a')).list()).toEqual([]);
	});
});
