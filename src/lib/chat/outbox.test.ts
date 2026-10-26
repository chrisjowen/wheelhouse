import { describe, expect, it } from 'vitest';
import type { Item } from './fold';
import { pendingLabel, unconfirmed, type Pending } from './outbox';

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

describe('pendingLabel', () => {
	it('says where the message is', () => {
		expect(pendingLabel(p({ state: 'sending' }))).toBe('Sending…');
		expect(pendingLabel(p({ state: 'queued' }))).toMatch(/^Queued/);
		expect(pendingLabel(p({ state: 'failed', error: 'Offline.' }))).toBe('Not sent · Offline.');
		expect(pendingLabel(p({ via: 'inbox' }))).toBe('In Firstmate’s inbox');
	});
});
