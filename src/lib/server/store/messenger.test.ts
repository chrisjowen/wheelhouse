import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createScriptAdapter, type FirstmateAdapter } from '../firstmate/adapter';
import { Messenger, noteBody, validateSend, VIEW_MAX_MESSAGES } from './messenger';
import { MessageStore } from './store';
import { createFakeFirstmate, type FakeFirstmate } from '../../../../tests/helpers/fake-firstmate';
import { feedbackNote } from '../../preview';
import type { MessagesView } from '../../types';

let fm: FakeFirstmate;
let stateDir: string;
let clock: { t: number };

beforeEach(() => {
	fm = createFakeFirstmate();
	stateDir = mkdtempSync(path.join(tmpdir(), 'wh-state-'));
	clock = { t: Date.parse('2026-10-11T08:00:00Z') };
});
afterEach(() => {
	fm.cleanup();
	rmSync(stateDir, { recursive: true, force: true });
});

const storeFile = () => path.join(stateDir, 'messages.json');

async function make(
	opts: {
		unavailable?: string;
		adapter?: FirstmateAdapter;
		noteTimeoutMs?: number;
		file?: string;
		route?: (taskId: string) => string | null;
	} = {}
) {
	const store = await MessageStore.open(opts.file ?? storeFile(), fm.root);
	const adapter =
		opts.adapter ??
		createScriptAdapter(
			{ firstmateDir: fm.root, homeDir: fm.root },
			{ noteTimeoutMs: opts.noteTimeoutMs ?? 10_000, receiptsTimeoutMs: 10_000 }
		);
	const messenger = new Messenger({
		adapter,
		store,
		unavailable: opts.unavailable,
		route: opts.route,
		now: () => clock.t,
		retryBaseMs: 1_000,
		retryMaxMs: 8_000
	});
	return { messenger, store, adapter };
}

const send = (m: Messenger, requestId: string, text = 'hello', taskId: string | null = null) =>
	m.send({ requestId, text, taskId });

describe('validateSend', () => {
	it('requires a valid Idempotency-Key, non-empty text and a plain task id', () => {
		expect(validateSend(null, 'x', null)).toMatchObject({ ok: false, status: 400 });
		expect(validateSend('.bad', 'x', null)).toMatchObject({ ok: false, status: 400 });
		expect(validateSend('k', '   ', null)).toMatchObject({ ok: false, status: 400 });
		expect(validateSend('k', 'x', 'a;b')).toMatchObject({ ok: false, status: 400 });
		expect(validateSend('k', 'x'.repeat(17_000), null)).toMatchObject({ ok: false, status: 413 });
		expect(validateSend('k', '  hi  ', 'wh-1')).toEqual({
			ok: true,
			input: { requestId: 'k', text: 'hi', taskId: 'wh-1' }
		});
	});

	it('puts task context in a Re: prefix of the body', () => {
		expect(noteBody('What is left?', 'wh-talk-2')).toBe('Re: wh-talk-2\nWhat is left?');
		expect(noteBody('Hi', null)).toBe('Hi');
	});
});

describe('send', () => {
	it('records the request id, delivers the note and persists the outcome', async () => {
		const { messenger } = await make();
		const r = await send(messenger, 'wh-1', 'Is the tokyo secondmate gone?', 'wh-talk-2');
		expect(r).toMatchObject({
			ok: true,
			created: true,
			message: { delivery: 'delivered', acknowledged: null, taskId: 'wh-talk-2' }
		});
		expect(fm.notes().map((n) => [n.request_id, n.body])).toEqual([
			['wh-1', 'Re: wh-talk-2\nIs the tokyo secondmate gone?']
		]);
		const saved = JSON.parse(readFileSync(storeFile(), 'utf8'));
		expect(saved.messages[0]).toMatchObject({ requestId: 'wh-1', delivery: 'delivered' });
	});

	it('returns the original for a retried request id and never creates a second note', async () => {
		const { messenger } = await make();
		const a = await send(messenger, 'wh-2');
		const b = await send(messenger, 'wh-2');
		const [c, d] = await Promise.all([send(messenger, 'wh-3'), send(messenger, 'wh-3')]);
		expect(a.ok && b.ok && c.ok && d.ok).toBe(true);
		if (!a.ok || !b.ok) return;
		expect(b).toMatchObject({ created: false, message: { noteId: a.message.noteId } });
		expect(fm.notes()).toHaveLength(2);
		expect(messenger.view().messages).toHaveLength(2);
	});

	it('refuses a reused key with a different message', async () => {
		const { messenger } = await make();
		await send(messenger, 'wh-4', 'one');
		expect(await send(messenger, 'wh-4', 'two')).toMatchObject({ ok: false, status: 422 });
		expect(fm.notes()).toHaveLength(1);
	});

	it('refuses to send when messaging is unavailable', async () => {
		const { messenger } = await make({ unavailable: 'old inbox' });
		expect(await send(messenger, 'wh-5')).toMatchObject({ ok: false, status: 503 });
		expect(messenger.view()).toMatchObject({ available: false, reason: 'old inbox' });
	});

	it('marks a refusal (exit 1) as failed, and a retry with the same key can deliver it', async () => {
		const { messenger } = await make();
		fm.noteMode('fail');
		expect(await send(messenger, 'wh-6')).toMatchObject({ message: { delivery: 'failed' } });
		expect(fm.notes()).toHaveLength(0);
		fm.noteMode('ok');
		expect(await send(messenger, 'wh-6')).toMatchObject({
			created: false,
			message: { delivery: 'delivered' }
		});
		expect(fm.notes()).toHaveLength(1);
	});
});

describe('routing a change request', () => {
	const LIVE = 'Routing: the worker is still live; send it this change.';
	const GONE = 'Routing: the worker is gone; start a new run.';
	const change = feedbackNote('http://127.0.0.1:5173/', 'Make the button blue');

	it('puts the route under a change request: the live worker, or a new run when it is gone', async () => {
		let route = LIVE;
		const asked: string[] = [];
		const { messenger } = await make({ route: (id) => (asked.push(id), route) });
		await send(messenger, 'wh-r1', change, 'wh-task');
		route = GONE;
		await send(messenger, 'wh-r2', change, 'wh-task');
		expect(asked).toEqual(['wh-task', 'wh-task']);
		expect(
			fm
				.notes()
				.map((n) => n.body)
				.sort()
		).toEqual([`Re: wh-task\n${change}\n\n${LIVE}`, `Re: wh-task\n${change}\n\n${GONE}`].sort());
		// The route travels to Firstmate only; the message reads back as it was written.
		expect(messenger.view().messages.map((m) => m.text)).toEqual([change, change]);
	});

	it('routes nothing else, and a retry keeps the route it was first sent with', async () => {
		let route = LIVE;
		const { messenger } = await make({ route: () => route });
		await send(messenger, 'wh-r3', 'What is left?', 'wh-task');
		await send(messenger, 'wh-r4', change, null);
		fm.noteMode('fail');
		await send(messenger, 'wh-r5', change, 'wh-task');
		fm.noteMode('ok');
		route = GONE;
		await send(messenger, 'wh-r5', change, 'wh-task');
		expect(
			fm
				.notes()
				.map((n) => n.body)
				.sort()
		).toEqual(['Re: wh-task\nWhat is left?', change, `Re: wh-task\n${change}\n\n${LIVE}`].sort());
	});
});

describe('an unwritable state directory', () => {
	const blocked = () => {
		const dir = path.join(stateDir, 'home');
		rmSync(dir, { recursive: true, force: true });
		writeFileSync(dir, 'not a directory');
	};
	const file = () => path.join(stateDir, 'home', 'messages.json');

	it('refuses a new message before Firstmate sees it and leaves nothing behind', async () => {
		mkdirSync(path.join(stateDir, 'home'));
		const { messenger } = await make({ file: file() });
		blocked();
		const r = await send(messenger, 'wh-30');
		expect(r).toMatchObject({ ok: false, status: 503 });
		expect(r.ok ? '' : r.error).toContain('could not record the message');
		expect(fm.notes()).toHaveLength(0);
		expect(messenger.view()).toMatchObject({
			messages: [],
			storeError: expect.stringContaining('could not write')
		});
		expect(await send(messenger, 'wh-30')).toMatchObject({ ok: false, status: 503 });
		expect(fm.notes()).toHaveLength(0);
	});

	it('keeps and shows the outcome of a note whose record cannot be written', async () => {
		mkdirSync(path.join(stateDir, 'home'));
		const { messenger } = await make({ file: file() });
		fm.noteMode('unannounced');
		await send(messenger, 'wh-31');
		await send(messenger, 'wh-32');
		blocked();
		fm.noteMode('ok');
		const seen: MessagesView[] = [];
		messenger.subscribe((v) => seen.push(v));
		expect(await send(messenger, 'wh-31')).toMatchObject({
			ok: true,
			created: false,
			message: { delivery: 'delivered' }
		});
		clock.t += 1_000;
		await expect(messenger.reconcile()).resolves.toBeUndefined();
		expect(messenger.view()).toMatchObject({
			messages: [
				expect.objectContaining({ requestId: 'wh-31', delivery: 'delivered' }),
				expect.objectContaining({ requestId: 'wh-32', delivery: 'delivered' })
			],
			storeError: expect.stringContaining('could not write')
		});
		expect(seen.at(-1)?.storeError).toEqual(expect.stringContaining('could not write'));
		expect(fm.notes()).toHaveLength(2);
	});
});

describe('reconciliation', () => {
	it('re-issues an exit-3 note with the same request id until Firstmate is woken', async () => {
		const { messenger } = await make();
		fm.noteMode('unannounced');
		expect(await send(messenger, 'wh-10')).toMatchObject({
			message: { delivery: 'saved-unannounced' }
		});
		fm.noteMode('ok');
		clock.t += 1_000;
		await messenger.reconcile();
		expect(messenger.view().messages[0]).toMatchObject({ delivery: 'delivered' });
		expect(fm.notes()).toEqual([expect.objectContaining({ request_id: 'wh-10', announced: true })]);
	});

	it('reconciles a timed-out send that Firstmate did save, without a duplicate', async () => {
		const { messenger } = await make({ noteTimeoutMs: 1_500 });
		fm.noteMode('save-then-sleep');
		expect(await send(messenger, 'wh-11')).toMatchObject({ message: { delivery: 'uncertain' } });
		expect(fm.notes()).toHaveLength(1);
		fm.noteMode('ok');
		clock.t += 1_000;
		await messenger.reconcile();
		expect(messenger.view().messages[0]).toMatchObject({ delivery: 'delivered' });
		expect(fm.notes()).toHaveLength(1);
	});

	it('reconciles a timed-out send that Firstmate never saved by sending it once', async () => {
		const { messenger } = await make({ noteTimeoutMs: 1_500 });
		fm.noteMode('sleep');
		expect(await send(messenger, 'wh-12')).toMatchObject({ message: { delivery: 'uncertain' } });
		expect(fm.notes()).toHaveLength(0);
		fm.noteMode('ok');
		clock.t += 1_000;
		await messenger.reconcile();
		await messenger.reconcile();
		expect(messenger.view().messages[0]).toMatchObject({ delivery: 'delivered' });
		expect(fm.notes()).toHaveLength(1);
	});

	it('backs off between re-issues', async () => {
		const { messenger } = await make();
		fm.noteMode('unannounced');
		await send(messenger, 'wh-13');
		const attempts = () =>
			readFileSync(path.join(fm.root, 'calls.log'), 'utf8').match(/\[note\]/g)?.length;
		await messenger.reconcile(); // not due: the first retry waits 1 s
		expect(attempts()).toBe(1);
		clock.t += 1_000;
		await messenger.reconcile();
		expect(attempts()).toBe(2);
		clock.t += 1_000; // the second retry waits 2 s
		await messenger.reconcile();
		expect(attempts()).toBe(2);
		clock.t += 1_000;
		await messenger.reconcile();
		expect(attempts()).toBe(3);
	});

	it('picks up acknowledgement and the recorded reply, and persists the cursor', async () => {
		const { messenger } = await make();
		const r = await send(messenger, 'wh-14');
		await messenger.reconcile();
		expect(messenger.view().messages[0]).toMatchObject({ acknowledged: false, reply: null });
		const noteId = r.ok ? r.message.noteId! : '';
		fm.ack(noteId);
		fm.reply(noteId, 'Aye, captain. One fixture left, then a validation round.');
		await messenger.reconcile();
		expect(messenger.view().messages[0]).toMatchObject({
			delivery: 'delivered',
			acknowledged: true,
			reply: { body: 'Aye, captain. One fixture left, then a validation round.' }
		});
		expect(JSON.parse(readFileSync(storeFile(), 'utf8')).receiptCursor).toBe('000000000001');
		expect(readFileSync(path.join(fm.root, 'calls.log'), 'utf8')).not.toContain('[--after]');
		await messenger.reconcile();
		expect(readFileSync(path.join(fm.root, 'calls.log'), 'utf8')).toContain(
			'[receipts] [--after] [000000000001]'
		);
	});

	it('lifts the receipts bounds when a message it tracks was omitted', async () => {
		const { messenger } = await make();
		await send(messenger, 'wh-old', 'oldest');
		const other = createScriptAdapter({ firstmateDir: fm.root, homeDir: fm.root });
		await new Promise((r) => setTimeout(r, 1100)); // fake note ids sort by second
		await other.note('voice-1', 'a note from somewhere else');
		await other.note('voice-2', 'another one');
		fm.set('receipts.bound', '1');
		await messenger.reconcile();
		expect(messenger.view().messages[0]).toMatchObject({ acknowledged: false });
		expect(readFileSync(path.join(fm.root, 'calls.log'), 'utf8')).toContain(
			'[--all-pending] [--all-handled]'
		);
	});

	it('keeps the last known state and says why when receipts cannot be read', async () => {
		const { messenger } = await make();
		await send(messenger, 'wh-15');
		fm.set('receipts.mode', 'fail');
		await messenger.reconcile();
		expect(messenger.view()).toMatchObject({
			receiptsError: expect.stringContaining('receipts broke'),
			messages: [expect.objectContaining({ delivery: 'delivered' })]
		});
	});

	it('pushes every change to subscribers', async () => {
		const { messenger } = await make();
		const seen: MessagesView[] = [];
		messenger.subscribe((v) => seen.push(v));
		await send(messenger, 'wh-16');
		expect(seen.map((v) => v.messages[0]?.delivery)).toEqual(['sending', 'delivered']);
	});

	it('does nothing until a message has been sent', async () => {
		const { messenger } = await make();
		await messenger.reconcile();
		expect(() => readFileSync(path.join(fm.root, 'calls.log'))).toThrow();
	});
});

describe('changeRequests', () => {
	it('lists every change request sent about a task, however many messages followed', async () => {
		const { messenger, store } = await make();
		const stored = (requestId: string, text: string, taskId: string | null) => ({
			requestId,
			text,
			taskId,
			body: noteBody(text, taskId),
			submittedAt: '2026-10-11T08:00:00.000Z',
			delivery: 'delivered' as const,
			deliveryDetail: null,
			noteId: null,
			acknowledged: null,
			announced: true,
			reply: null,
			attempts: 1,
			lastAttemptAt: null
		});
		store.add(stored('ask', feedbackNote('http://127.0.0.1:1/', 'Bigger'), 't1'));
		for (let i = 0; i < VIEW_MAX_MESSAGES; i++) store.add(stored(`chat-${i}`, 'hello', 't1'));
		expect(messenger.view().messages.some((m) => m.requestId === 'ask')).toBe(false);
		expect(messenger.changeRequests().map((m) => m.requestId)).toEqual(['ask']);
	});
});
