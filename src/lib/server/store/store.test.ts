import {
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	defaultStateDir,
	isInside,
	MessageStore,
	STORE_MAX_MESSAGES,
	storeFileFor,
	type StoredMessage
} from './store';

let dir: string;
beforeEach(() => {
	dir = mkdtempSync(path.join(tmpdir(), 'wh-store-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const message = (requestId: string, extra: Partial<StoredMessage> = {}): StoredMessage => ({
	requestId,
	text: 'hello',
	taskId: null,
	body: 'hello',
	submittedAt: '2026-10-11T08:00:00.000Z',
	delivery: 'delivered',
	deliveryDetail: null,
	noteId: 'n-1',
	acknowledged: null,
	announced: true,
	reply: null,
	attempts: 1,
	lastAttemptAt: '2026-10-11T08:00:00.000Z',
	...extra
});

describe('where the store lives', () => {
	it('prefers WHEELHOUSE_STATE_DIR, then XDG_STATE_HOME, then ~/.local/state', () => {
		expect(defaultStateDir({ WHEELHOUSE_STATE_DIR: '/s', XDG_STATE_HOME: '/x', HOME: '/h' })).toBe(
			'/s'
		);
		expect(defaultStateDir({ XDG_STATE_HOME: '/x', HOME: '/h' })).toBe('/x/wheelhouse');
		expect(defaultStateDir({ HOME: '/h' })).toBe('/h/.local/state/wheelhouse');
	});

	it('keeps one file per Firstmate home, stable across launches', () => {
		const a = storeFileFor('/s', '/homes/a');
		expect(storeFileFor('/s', '/homes/a')).toBe(a);
		expect(storeFileFor('/s', '/homes/b')).not.toBe(a);
		expect(a).toMatch(/^\/s\/homes\/[0-9a-f]{16}\/messages\.json$/);
	});

	it('knows when a directory is inside the Firstmate home', () => {
		const home = path.join(dir, 'home');
		mkdirSync(path.join(home, 'state'), { recursive: true });
		expect(isInside(path.join(home, 'state', 'wh'), home)).toBe(true);
		expect(isInside(home, home)).toBe(true);
		expect(isInside(path.join(dir, 'elsewhere'), home)).toBe(false);
		expect(isInside(`${home}-sibling`, home)).toBe(false);
	});
});

describe('MessageStore', () => {
	const file = () => path.join(dir, 'homes', 'abc', 'messages.json');

	it('starts empty and round-trips messages and the receipts cursor, owner-only', async () => {
		const s = await MessageStore.open(file(), '/home');
		expect(s.messages()).toEqual([]);
		s.add(message('r-1', { taskId: 'wh-1', body: 'Re: wh-1\nhello' }));
		s.receiptCursor = '000000000004';
		await s.save();
		expect(statSync(file()).mode & 0o777).toBe(0o600);
		expect(statSync(path.dirname(file())).mode & 0o777).toBe(0o700);
		const again = await MessageStore.open(file(), '/home');
		expect(again.messages()).toEqual([message('r-1', { taskId: 'wh-1', body: 'Re: wh-1\nhello' })]);
		expect(again.receiptCursor).toBe('000000000004');
		expect(JSON.parse(readFileSync(file(), 'utf8')).home).toBe('/home');
	});

	it('turns a message left sending by a stopped Wheelhouse into uncertain', async () => {
		const s = await MessageStore.open(file(), '/home');
		s.add(message('r-1', { delivery: 'sending' }));
		await s.save();
		const again = await MessageStore.open(file(), '/home');
		expect(again.get('r-1')).toMatchObject({ delivery: 'uncertain' });
	});

	it('writes the store as it was when save was called, and the latest save wins', async () => {
		const s = await MessageStore.open(file(), '/home');
		s.add(message('r-1'));
		const first = s.save();
		s.add(message('r-2'));
		s.receiptCursor = '000000000009';
		await first;
		const saved = () => JSON.parse(readFileSync(file(), 'utf8'));
		expect(saved().messages.map((m: StoredMessage) => m.requestId)).toEqual(['r-1']);
		expect(saved().receiptCursor).toBe('');
		const second = s.save();
		s.remove('r-2');
		const third = s.save();
		await Promise.all([second, third]);
		expect(saved().messages.map((m: StoredMessage) => m.requestId)).toEqual(['r-1']);
		expect(saved().receiptCursor).toBe('000000000009');
	});

	it('moves an unreadable store aside instead of deleting it', async () => {
		mkdirSync(path.dirname(file()), { recursive: true });
		writeFileSync(file(), '{ torn');
		const s = await MessageStore.open(file(), '/home');
		expect(s.messages()).toEqual([]);
		expect(s.recovered).toMatch(/messages\.json\.unreadable-\d+$/);
		expect(readFileSync(s.recovered!, 'utf8')).toBe('{ torn');
	});

	it('keeps at most STORE_MAX_MESSAGES, dropping the oldest', async () => {
		const s = await MessageStore.open(file(), '/home');
		for (let i = 0; i < STORE_MAX_MESSAGES + 3; i++) s.add(message(`r-${i}`));
		expect(s.messages()).toHaveLength(STORE_MAX_MESSAGES);
		expect(s.messages()[0].requestId).toBe('r-3');
	});

	it('serialises concurrent saves and leaves no temporary files', async () => {
		const s = await MessageStore.open(file(), '/home');
		s.add(message('r-1'));
		await Promise.all([s.save(), s.save(), s.save()]);
		expect(readdirSync(path.dirname(file()))).toEqual(['messages.json']);
	});
});
