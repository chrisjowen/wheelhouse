import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
