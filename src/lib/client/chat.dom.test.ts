import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fold } from '$lib/chat/fold';

class FakeSource {
	static all: FakeSource[] = [];
	static CLOSED = 2;
	readyState = 1;
	listeners = new Map<string, ((e: MessageEvent) => void)[]>();
	constructor(public url: string) {
		FakeSource.all.push(this);
	}
	addEventListener(type: string, fn: (e: MessageEvent) => void) {
		this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
	}
	emit(type: string, data: unknown) {
		for (const fn of this.listeners.get(type) ?? [])
			fn({ data: JSON.stringify(data) } as MessageEvent);
	}
	close() {
		this.readyState = FakeSource.CLOSED;
	}
}

const feed = () => FakeSource.all.find((s) => s.url === '/api/firstmate/chat')!;
const rec = (uuid: string, extra: Record<string, unknown> = {}) => ({
	type: 'user',
	uuid,
	timestamp: `2026-11-14T10:00:0${uuid.length % 10}Z`,
	message: { role: 'user', content: uuid },
	...extra
});
const source = (file: string, session: string) => ({ file, session });

let requests: URL[];
let answer: { available: boolean; records: unknown[]; more: boolean };
let disconnect: (() => void) | null = null;

beforeEach(() => {
	FakeSource.all = [];
	requests = [];
	answer = { available: true, records: [], more: false };
	vi.stubGlobal('EventSource', FakeSource);
	vi.stubGlobal(
		'fetch',
		vi.fn(async (input: string) => {
			const url = new URL(input, 'http://wh.test');
			requests.push(url);
			const body = url.pathname === '/api/firstmate/commands' ? { commands: [] } : answer;
			return new Response(JSON.stringify(body), { status: 200 });
		})
	);
});
afterEach(() => {
	disconnect?.();
	disconnect = null;
	vi.unstubAllGlobals();
});

/** A fresh page's chat, connected to the feed. */
async function connected() {
	vi.resetModules();
	const { firstmateChat: chat } = await import('./chat.svelte');
	disconnect = chat.connect();
	return chat;
}

describe('FirstmateChat across a restart', () => {
	it('keeps the outgoing session, with the new one’s divider, through a reset to nothing', async () => {
		const chat = await connected();
		feed().emit('reset', source('/fm/a.jsonl', 'a'));
		feed().emit('records', [rec('a1'), rec('a2')]);
		feed().emit('reset', null);
		feed().emit('reset', source('/fm/b.jsonl', 'b'));
		feed().emit('records', [rec('b1')]);
		expect(chat.all.map((r) => r.uuid)).toEqual(['a1', 'a2', 'wh-session:b', 'b1']);
	});

	it('adds no divider when the same session comes back after a reset to nothing', async () => {
		const chat = await connected();
		feed().emit('reset', source('/fm/a.jsonl', 'a'));
		feed().emit('records', [rec('a1'), rec('a2')]);
		feed().emit('reset', null);
		feed().emit('reset', source('/fm/a.jsonl', 'a'));
		feed().emit('records', [rec('a1'), rec('a2'), rec('a3')]);
		expect(chat.all.map((r) => r.uuid)).toEqual(['a1', 'a2', 'a3']);
	});
});

describe('FirstmateChat reading back', () => {
	it('offers the archive its oldest records it can hold, and their time', async () => {
		const chat = await connected();
		feed().emit('reset', source('/fm/a.jsonl', 'a'));
		feed().emit('records', [rec('side', { isSidechain: true }), rec('a1'), rec('a2')]);
		answer = { available: true, records: [rec('a0')], more: true };
		expect(await chat.loadOlder()).toBe(true);
		const q = requests.find((u) => u.pathname === '/api/firstmate/chat/history')!.searchParams;
		expect(q.getAll('before')).toEqual(['a1', 'a2']);
		expect(q.get('at')).toBe(rec('a1').timestamp);
		expect(chat.all.map((r) => r.uuid)).toEqual(['a0', 'side', 'a1', 'a2']);
		expect(chat.older).toBe('more');
	});

	it('stops when a page adds nothing new', async () => {
		const chat = await connected();
		feed().emit('reset', source('/fm/a.jsonl', 'a'));
		feed().emit('records', [rec('a1')]);
		answer = { available: true, records: [rec('a1')], more: true };
		expect(await chat.loadOlder()).toBe(false);
		expect(chat.older).toBe('none');
	});
});

const reply = (uuid: string, content: unknown[]) => ({
	type: 'assistant',
	uuid,
	timestamp: '2026-11-14T10:00:00Z',
	message: { role: 'assistant', content }
});
const result = (uuid: string, tool: string) => ({
	type: 'user',
	uuid,
	timestamp: '2026-11-14T10:00:00Z',
	message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: tool, content: 'ok' }] }
});
/** `n` exchanges of a captain's message and a reply, named from `p`. */
const exchanges = (p: string, n: number) =>
	Array.from({ length: n }, (_, i) => [
		rec(`${p}${i}-q`),
		reply(`${p}${i}-a`, [{ type: 'text', text: `reply ${i}` }])
	]).flat();

describe('FirstmateChat history', () => {
	it('folds as one chat across history and the live records, without folding history again', async () => {
		const chat = await connected();
		feed().emit('reset', source('/fm/a.jsonl', 'a'));
		feed().emit('records', [
			reply('live-a', [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } }])
		]);
		answer = { available: true, records: exchanges('h', 3), more: true };
		await chat.loadOlder();
		feed().emit('records', [result('live-r', 't1')]);
		expect(chat.chat).toEqual(fold(chat.all));
		const first = chat.chat.items[0];
		feed().emit('records', [reply('live-b', [{ type: 'text', text: 'done' }])]);
		expect(chat.chat).toEqual(fold(chat.all));
		expect(chat.chat.items[0]).toBe(first);
	});

	it('lets go of the oldest history beyond its cap, and reads it back again', async () => {
		const chat = await connected();
		feed().emit('reset', source('/fm/a.jsonl', 'a'));
		feed().emit('records', [rec('live-q')]);
		const pages = [exchanges('c', 1500), exchanges('b', 1500), exchanges('a', 1500)];
		for (const page of pages) {
			answer = { available: true, records: page, more: true };
			expect(await chat.loadOlder()).toBe(true);
		}
		expect(chat.history).toHaveLength(9000);
		chat.trim();
		expect(chat.history).toHaveLength(6000);
		expect(chat.history[0].uuid).toBe('b0-q');
		expect(chat.older).toBe('more');
		answer = { available: true, records: pages[2], more: false };
		requests = [];
		expect(await chat.loadOlder()).toBe(true);
		const q = requests.find((u) => u.pathname === '/api/firstmate/chat/history')!.searchParams;
		expect(q.getAll('before')[0]).toBe('b0-q');
		expect(chat.history).toHaveLength(9000);
		expect(chat.history[0].uuid).toBe('a0-q');
		expect(chat.older).toBe('none');
	});

	it('leaves out a page that no longer joins on, history having been trimmed while it came', async () => {
		const chat = await connected();
		feed().emit('reset', source('/fm/a.jsonl', 'a'));
		feed().emit('records', [rec('live-q')]);
		answer = { available: true, records: exchanges('b', 3500), more: true };
		await chat.loadOlder();
		answer = { available: true, records: exchanges('a', 1), more: true };
		const loading = chat.loadOlder();
		chat.trim();
		expect(await loading).toBe(false);
		expect(chat.history[0].uuid).toBe('b500-q');
		expect(chat.older).toBe('unknown');
	});
});
