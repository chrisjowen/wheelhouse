import { describe, expect, it } from 'vitest';
import { fold, type Item } from './fold';
import { IDLE_FALLBACK, lastId, pendingLabel, unconfirmed, type Pending } from './outbox';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Rec = Record<string, any>;

const user = (id: string, text: string): Item => ({
	kind: 'user',
	id,
	text,
	at: '2026-10-26T10:00:00Z',
	queued: false,
	command: false
});
const turn = (id: string) => ({ kind: 'turn', id }) as unknown as Item;
const p = (o: Partial<Pending>): Pending => ({
	id: 'p',
	text: 'hello',
	via: 'session',
	state: 'delivered',
	error: null,
	after: null,
	...o
});

// Synthetic records shaped like Claude Code 2.1.x transcript lines (never real ones).
let n = 0;
const at = (s: number) => new Date(Date.parse('2026-01-01T10:00:00Z') + s * 1000).toISOString();
const rec = (o: Rec): Rec => ({ uuid: `r${++n}`, timestamp: at(n), ...o });
const typed = (content: string) =>
	rec({ type: 'user', origin: { kind: 'human' }, message: { role: 'user', content } });
const say = (text: string) =>
	rec({
		type: 'assistant',
		message: { id: 'm', role: 'assistant', content: [{ type: 'text', text }] }
	});
const tool = (id: string) =>
	rec({
		type: 'assistant',
		message: {
			id: 'm',
			role: 'assistant',
			content: [{ type: 'tool_use', id, name: 'Bash', input: { command: 'ls' } }]
		}
	});
const queued = (prompt: string) =>
	rec({
		type: 'attachment',
		attachment: { type: 'queued_command', prompt, commandMode: 'prompt' }
	});
const meta = (text: string, toolId: string) =>
	rec({
		type: 'user',
		isMeta: true,
		message: {
			role: 'user',
			content: [
				{ type: 'tool_result', tool_use_id: toolId, content: 'ok' },
				{ type: 'text', text }
			]
		}
	});
const ended = () => rec({ type: 'system', subtype: 'turn_duration', durationMs: 1000 });

/** A queued message sent while Firstmate is mid-turn, and the chat items once `later` lands. */
function sendWhileBusy(text: string, later: Rec[]) {
	const before = [typed('Start the build'), say('On it.'), tool('t1')];
	const msg = p({ text, state: 'queued', after: lastId(fold(before).items) });
	return { msg, items: fold([...before, ...later]).items };
}

describe('unconfirmed', () => {
	it('keeps a message until the transcript records its text', () => {
		const msg = p({ text: 'hello  there' });
		expect(unconfirmed([msg], [])).toEqual([msg]);
		expect(unconfirmed([msg], [user('u1', 'hello there')])).toEqual([]);
	});

	it('does not clear on an earlier message with the same text', () => {
		const msg = p({ text: 'yes', after: 'u1' });
		expect(unconfirmed([msg], [user('u1', 'yes')])).toEqual([msg]);
		expect(unconfirmed([msg], [user('u1', 'yes'), user('u2', 'yes')])).toEqual([]);
	});

	it('clears on the echo once the transcript starts over', () => {
		const msg = p({ text: 'yes', after: 'u1' });
		expect(unconfirmed([msg], [user('n1', 'yes')])).toEqual([]);
	});

	it('clears on the echo after older items were trimmed', () => {
		const msg = p({ text: 'yes', after: 'u2' });
		const trimmed = [user('u2', 'yes'), user('u3', 'yes')];
		expect(unconfirmed([msg], trimmed)).toEqual([]);
		expect(unconfirmed([msg], [user('u2', 'yes')])).toEqual([msg]);
	});

	it('lets earlier copies of the same text claim their echo first', () => {
		const a = p({ id: 'a', text: 'go' });
		const b = p({ id: 'b', text: 'go' });
		expect(unconfirmed([a, b], [user('u1', 'go')])).toEqual([b]);
	});

	it('keeps sending and failed messages whatever the transcript shows', () => {
		const s = p({ state: 'sending' });
		const f = p({ id: 'f', state: 'failed' });
		expect(unconfirmed([s, f], [user('u1', 'hello'), user('u2', 'hello')])).toEqual([s, f]);
	});

	it('clears an inbox note once Firstmate starts a turn', () => {
		const note = p({ via: 'inbox', after: 't1' });
		expect(unconfirmed([note], [turn('t1')])).toEqual([note]);
		expect(unconfirmed([note], [turn('t1'), turn('t2')])).toEqual([]);
	});

	it('clears an inbox note on a new turn once older turns were trimmed', () => {
		const note = p({ via: 'inbox', after: 't2' });
		expect(unconfirmed([note], [turn('t2'), turn('t3')])).toEqual([]);
		expect(unconfirmed([note], [turn('t9')])).toEqual([]);
	});
});

describe('unconfirmed, for a message queued while Firstmate is busy', () => {
	it('stays queued while the turn runs on without it', () => {
		const { msg, items } = sendWhileBusy('Also check the docs', [say('Still building.')]);
		expect(unconfirmed([msg], items)).toEqual([msg]);
	});

	it('clears when Claude Code hands it over mid-turn', () => {
		const { msg, items } = sendWhileBusy('Also check the docs', [
			queued('Also check the docs'),
			say('Will do.')
		]);
		expect(unconfirmed([msg], items)).toEqual([]);
	});

	it('clears when it arrives as the next prompt after the turn ends', () => {
		const { msg, items } = sendWhileBusy('Also check the docs', [
			ended(),
			typed('Also check the docs'),
			say('Checking.')
		]);
		expect(unconfirmed([msg], items)).toEqual([]);
	});

	it('clears when Claude Code wraps the paste in pasted_content tags', () => {
		const text = 'Two things:\n1. the header\n2. the footer';
		const wrapped = `<pasted_content id="c952">\n${text}\n</pasted_content id="c952">`;
		const viaFold = sendWhileBusy(text, [queued(wrapped)]);
		expect(unconfirmed([viaFold.msg], viaFold.items)).toEqual([]);
		// Even where the tags reach the chat unstripped.
		expect(unconfirmed([p({ text, after: 'u0' })], [user('u0', 'x'), user('u1', wrapped)])).toEqual(
			[]
		);
	});

	it('clears when the transcript spaces or wraps its lines differently', () => {
		const { msg, items } = sendWhileBusy('  Keep   the header\r\n\r\nand the footer  ', [
			queued('Keep the header\n\nand  the footer')
		]);
		expect(unconfirmed([msg], items)).toEqual([]);
	});

	it('clears two queued messages Claude Code delivers as one', () => {
		const first = sendWhileBusy('Also check the docs', [
			ended(),
			typed('Also check the docs\nAnd bump the version'),
			say('Both done.')
		]);
		const second = p({ id: 'b', text: 'And bump the version', after: first.msg.after });
		expect(unconfirmed([first.msg, second], first.items)).toEqual([]);
	});

	it('does not clear on a merely similar word inside another message', () => {
		const { msg, items } = sendWhileBusy('go', [ended(), typed('goal set'), say('Noted.')]);
		expect(unconfirmed([msg], items)).toEqual([msg]);
	});

	it('clears when it reaches Firstmate as a "sent a new message while you were working" reminder', () => {
		const { msg, items } = sendWhileBusy('Also check the docs', [
			meta(
				'<system-reminder>\nThe user sent a new message while you were working:\nAlso check the docs\n\nAddress the message above as you continue this turn.\n</system-reminder>',
				't1'
			),
			say('Will do.')
		]);
		expect(items.some((i) => i.kind === 'user' && i.id !== items[0].id)).toBe(false);
		expect(unconfirmed([msg], items)).toEqual([]);
	});

	it('clears on the echo after a /clear started the transcript over', () => {
		const { msg } = sendWhileBusy('Also check the docs', []);
		const fresh = fold([typed('Also check the docs'), say('Checking.')]).items;
		expect(unconfirmed([msg], fresh)).toEqual([]);
	});

	it('clears on the echo once the turn it was sent during was trimmed away', () => {
		const { msg } = sendWhileBusy('Also check the docs', []);
		const trimmed = fold([say('…the rest of the build.'), queued('Also check the docs')]).items;
		expect(unconfirmed([msg], trimmed)).toEqual([]);
	});

	it(`reads as sent, not queued, once Firstmate has finished ${IDLE_FALLBACK} turns without it showing`, () => {
		const once = sendWhileBusy('Also check the docs', [ended(), typed('unrelated'), say('Ok.')]);
		expect(unconfirmed([once.msg], once.items)).toEqual([once.msg]);
		const twice = sendWhileBusy('Also check the docs', [
			ended(),
			typed('unrelated'),
			say('Ok.'),
			ended(),
			typed('another'),
			say('Ok.'),
			ended()
		]);
		const [shown] = unconfirmed([twice.msg], twice.items);
		expect(shown).toEqual({ ...twice.msg, state: 'sent' });
		expect(pendingLabel(shown)).toBe('Sent');
		// Already sent, it stays the same object, so the page does not churn.
		expect(unconfirmed([shown], twice.items)[0]).toBe(shown);
	});
});

describe('pendingLabel', () => {
	it('says where the message is', () => {
		expect(pendingLabel(p({ state: 'sending' }))).toBe('Sending…');
		expect(pendingLabel(p({ state: 'queued' }))).toMatch(/^Queued/);
		expect(pendingLabel(p({ state: 'sent' }))).toBe('Sent');
		expect(pendingLabel(p({ state: 'failed', error: 'Offline.' }))).toBe('Not sent · Offline.');
		expect(pendingLabel(p({ via: 'inbox' }))).toBe('In Firstmate’s inbox');
	});
});
