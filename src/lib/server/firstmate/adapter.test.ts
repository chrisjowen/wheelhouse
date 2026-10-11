import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createScriptAdapter, NOTE_MAX_BYTES } from './adapter';
import {
	createFakeFirstmate,
	snapshotFixture,
	taskRow,
	type FakeFirstmate
} from '../../../../tests/helpers/fake-firstmate';

let fm: FakeFirstmate;
const adapter = (opts = {}) =>
	createScriptAdapter({ firstmateDir: fm.root, homeDir: fm.root }, opts);
const calls = () => readFileSync(path.join(fm.root, 'calls.log'), 'utf8').trim().split('\n');

beforeEach(() => {
	fm = createFakeFirstmate();
});
afterEach(() => fm.cleanup());

describe('snapshot', () => {
	it('runs fm-fleet-snapshot.sh --json with FM_HOME and parses the contract', async () => {
		fm.set('snapshot.json', snapshotFixture({ tasks: [taskRow({ id: 'a-1' })] }, fm.root));
		const r = await adapter().snapshot();
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.value.tasks.map((t) => t.id)).toEqual(['a-1']);
		expect(r.value.tasks[0].current?.state).toBe('working');
		expect(calls()).toEqual([`fm-fleet-snapshot.sh [--json] FM_HOME=${fm.root}`]);
	});

	it('reports malformed output without throwing', async () => {
		fm.mode('fm-fleet-snapshot.sh', 'malformed');
		const r = await adapter().snapshot();
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.error).toMatchObject({ kind: 'malformed', script: 'fm-fleet-snapshot.sh' });
	});

	it('rejects an unknown schema', async () => {
		fm.set('snapshot.json', { ...snapshotFixture(), schema: 'fm-fleet-snapshot.v2' });
		const r = await adapter().snapshot();
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.error.message).toContain('fm-fleet-snapshot.v2');
	});

	it('reports a failing script with its stderr', async () => {
		fm.mode('fm-fleet-snapshot.sh', 'fail');
		const r = await adapter().snapshot();
		expect(r.ok).toBe(false);
		if (!r.ok) {
			expect(r.error.kind).toBe('exit');
			expect(r.error.message).toContain('something broke');
		}
	});

	it('times out a hung script and kills it', async () => {
		fm.mode('fm-fleet-snapshot.sh', 'sleep');
		const started = Date.now();
		const r = await adapter({ snapshotTimeoutMs: 300 }).snapshot();
		expect(Date.now() - started).toBeLessThan(5000);
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.error.kind).toBe('timeout');
	});

	it('bounds output size', async () => {
		fm.mode('fm-fleet-snapshot.sh', 'huge');
		const r = await adapter().snapshot();
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.error.kind).toBe('output-limit');
	});

	it('reports a missing script', async () => {
		fm.set('bin/fm-fleet-snapshot.sh', '');
		const { rmSync } = await import('node:fs');
		rmSync(path.join(fm.root, 'bin', 'fm-fleet-snapshot.sh'));
		const r = await adapter().snapshot();
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.error.kind).toBe('missing-script');
	});
});

describe('ready', () => {
	it('parses fm-primary-ready.v1', async () => {
		const r = await adapter().ready();
		expect(r.ok).toBe(true);
		if (r.ok) {
			expect(r.value.canReceive).toBe(true);
			expect(r.value.wakeConsumer.state).toBe('healthy');
		}
		expect(calls()[0]).toMatch(/^fm-inbox\.sh \[ready\]/);
	});

	it('keeps an unknown can_receive as unknown', async () => {
		fm.set('ready.json', {
			schema: 'fm-primary-ready.v1',
			lock: { state: 'free' },
			wake_consumer: { state: 'unknown' },
			can_receive: 'unknown'
		});
		const r = await adapter().ready();
		expect(r.ok && r.value.canReceive).toBe('unknown');
	});
});

describe('peek', () => {
	it('passes the task id and a clamped line count as separate arguments', async () => {
		await adapter().peek('wh-crew-1', 9999);
		expect(calls()[0]).toMatch(/^fm-peek\.sh \[wh-crew-1\] \[200\]/);
	});

	it('never passes an id that is not a plain task id', async () => {
		for (const bad of ['a;rm -rf /', '-n', '../x', 'a b', '$(id)']) {
			const r = await adapter().peek(bad, 10);
			expect(r.ok).toBe(false);
			if (!r.ok) expect(r.error.kind).toBe('invalid-argument');
		}
		expect(() => calls()).toThrow();
	});

	it('strips terminal escapes and keeps only the requested tail', async () => {
		fm.set('peek.txt', 'one\n\u001b[31mtwo\u001b[0m\nthree\u0007\n\n\n');
		const r = await adapter().peek('t-1', 2);
		expect(r.ok && r.value.lines).toEqual(['two', 'three']);
	});
});

describe('note', () => {
	const stdinLog = () =>
		readFileSync(path.join(fm.root, 'note-stdin.log'), 'utf8')
			.trim()
			.split('\n')
			.map((l) => JSON.parse(l) as string);

	it('passes the request id as its own argument and the body only on stdin', async () => {
		const body = '--json $(id); rm -rf / `whoami`\nsecond line';
		const r = await adapter().note('wh-req-1', body);
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.value).toMatchObject({ outcome: 'created', requestId: 'wh-req-1', announced: true });
		expect(calls()).toEqual([
			`fm-inbox.sh [note] [--request-id] [wh-req-1] [--json] [-] FM_HOME=${fm.root}`
		]);
		expect(stdinLog()).toEqual([body]);
		expect(fm.notes().map((n) => n.body)).toEqual([body]);
	});

	it('replays the original note for a repeated request id', async () => {
		const a = await adapter().note('wh-req-2', 'first');
		const b = await adapter().note('wh-req-2', 'first');
		expect(a.ok && b.ok).toBe(true);
		if (!a.ok || !b.ok) return;
		expect(b.value).toMatchObject({ outcome: 'replay', noteId: a.value.noteId });
		expect(fm.notes()).toHaveLength(1);
	});

	it('treats exit 3 as saved but not announced', async () => {
		fm.noteMode('unannounced');
		const r = await adapter().note('wh-req-3', 'hello');
		expect(r.ok).toBe(true);
		if (r.ok) expect(r.value).toMatchObject({ saved: true, announced: false });
		expect(fm.notes()).toHaveLength(1);
	});

	it('reports exit 1 as a refusal with nothing saved', async () => {
		fm.noteMode('fail');
		const r = await adapter().note('wh-req-4', 'hello');
		expect(r.ok).toBe(false);
		if (!r.ok) {
			expect(r.error).toMatchObject({ kind: 'exit', exitCode: 1 });
			expect(r.error.message).toContain('could not queue the note');
		}
		expect(fm.notes()).toHaveLength(0);
	});

	it('times out a hung note as a timeout, not a refusal', async () => {
		fm.noteMode('sleep');
		const r = await adapter({ noteTimeoutMs: 300 }).note('wh-req-5', 'hello');
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.error.kind).toBe('timeout');
	});

	it('reports unreadable output as malformed', async () => {
		fm.noteMode('malformed');
		const r = await adapter().note('wh-req-6', 'hello');
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.error.kind).toBe('malformed');
	});

	it('never runs the script for a bad request id, an empty body or an oversized one', async () => {
		for (const [id, body] of [
			['', 'x'],
			['.hidden', 'x'],
			['a b', 'x'],
			['a/b', 'x'],
			['x'.repeat(129), 'x'],
			['ok-id', '   \n'],
			['ok-id', 'x'.repeat(NOTE_MAX_BYTES + 1)]
		]) {
			const r = await adapter().note(id, body);
			expect(r.ok).toBe(false);
			if (!r.ok) expect(r.error.kind).toBe('invalid-argument');
		}
		expect(() => calls()).toThrow();
	});
});

describe('receipts', () => {
	it('parses fm-inbox-receipts.v1 and passes the cursor and bounds as arguments', async () => {
		const sent = await adapter().note('wh-r-1', 'hi');
		expect(sent.ok).toBe(true);
		if (!sent.ok) return;
		fm.ack(sent.value.noteId);
		fm.reply(sent.value.noteId, 'Aye.');
		const r = await adapter().receipts({ after: '000000000000', allNotes: true });
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.value.pending).toEqual([]);
		expect(r.value.handled[0]).toMatchObject({
			requestId: 'wh-r-1',
			acknowledged: true,
			reply: { body: 'Aye.', cursor: '000000000001' }
		});
		expect(r.value.replies.map((x) => x.body)).toEqual(['Aye.']);
		expect(r.value.replyCursor).toBe('000000000001');
		expect(calls().at(-1)).toBe(
			`fm-inbox.sh [receipts] [--after] [000000000000] [--all-pending] [--all-handled] FM_HOME=${fm.root}`
		);
	});

	it('drops a cursor that is not a plain sequence', async () => {
		await adapter().receipts({ after: '--all-replies' });
		expect(calls()).toEqual([`fm-inbox.sh [receipts] FM_HOME=${fm.root}`]);
	});

	it('rejects an unknown receipts schema', async () => {
		fm.set('bin/fm-inbox.sh', '#!/bin/sh\necho \'{"schema":"fm-inbox-receipts.v2"}\'\n');
		const r = await adapter().receipts();
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.error).toMatchObject({ kind: 'malformed' });
	});
});
