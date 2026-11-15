import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CrewDiscussion, CrewMessage } from '$lib/crew';
import { taskSummary } from '../../../../../tests/helpers/task-summary';

vi.mock('$app/state', () => ({ page: { data: {} } }));

const { default: Discussion } = await import('./Discussion.svelte');

/** The worker's conversation stream: the test sends its events. */
class FakeSource extends EventTarget {
	static last: FakeSource | null = null;
	static readonly CLOSED = 2;
	readyState = 1;
	constructor(readonly url: string) {
		super();
		FakeSource.last = this;
	}
	emit(type: string, data: unknown) {
		this.dispatchEvent(new MessageEvent(type, { data: JSON.stringify(data) }));
	}
	close() {
		this.readyState = 2;
	}
}

const OPENED = '2026-11-15T10:00:00.000Z';
const said = (id: string, over: Partial<CrewMessage> = {}): CrewMessage => ({
	id,
	kind: 'say',
	text: 'Use Pagefind, please.',
	at: '2026-11-15T10:01:00.000Z',
	delivery: 'sent',
	error: null,
	seen: false,
	told: 'sent',
	...over
});
const discussion = (messages: CrewMessage[], paused = false): CrewDiscussion => ({
	taskId: 'tide',
	title: 'lumen: tide',
	projectId: 'lumen',
	openedAt: OPENED,
	paused,
	messages
});

let app: ReturnType<typeof mount> | null = null;
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
	vi.stubGlobal('EventSource', FakeSource);
	fetchMock = vi.fn(async () => new Response('{}', { status: 201 }));
	vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
	if (app) unmount(app);
	app = null;
	document.body.innerHTML = '';
	vi.unstubAllGlobals();
});

function show(d: CrewDiscussion | null, task = taskSummary('tide', 'working')) {
	app = mount(Discussion, {
		target: document.body,
		props: { taskId: 'tide', discussion: d, task, token: 'tok' }
	});
	flushSync();
}
const text = () => document.body.textContent?.replace(/\s+/g, ' ') ?? '';

describe('a crew discussion', () => {
	it('follows the worker’s own conversation, with the captain’s message and its receipts among it', () => {
		show(discussion([said('m1')]));
		expect(FakeSource.last?.url).toBe('/api/tasks/tide/chat');
		FakeSource.last!.emit('session', {
			state: 'external',
			reason: null,
			harness: 'claude',
			busy: false
		});
		FakeSource.last!.emit('reset', { how: 'worktree', file: '/x.jsonl', truncated: false });
		FakeSource.last!.emit('records', [
			{
				type: 'assistant',
				uuid: 'a1',
				timestamp: '2026-11-15T10:02:00.000Z',
				message: {
					id: 'a1',
					role: 'assistant',
					content: [{ type: 'text', text: 'Pagefind it is.' }]
				}
			}
		]);
		FakeSource.last!.emit('synced', null);
		flushSync();
		const order = [...document.querySelectorAll('[data-discussion-feed] article')].map((a) =>
			a.getAttribute('aria-label')
		);
		expect(order).toHaveLength(2);
		expect(order[0]).toMatch(/^You, /);
		expect(order[1]).toMatch(/^tide, /);
		expect(text()).toContain('You’re talking to tide directly');
		expect(text()).toContain('Pagefind it is.');
		expect(document.querySelector('[data-receipt]')?.getAttribute('data-receipt')).toBe('sent');
		expect(text()).toContain('In its inbox');
		expect(text()).toContain('Firstmate told');
	});

	it('says when the worker has read it, and offers to send a failed one again with its own id', async () => {
		show(
			discussion([
				said('m1', { seen: true }),
				said('m2', { delivery: 'failed', error: 'no metadata' })
			])
		);
		const receipts = [...document.querySelectorAll('[data-receipt]')].map((r) =>
			r.getAttribute('data-receipt')
		);
		expect(receipts).toEqual(['seen', 'failed']);
		expect(text()).toContain('Seen by tide');
		expect(text()).toContain('no metadata');
		const again = [...document.querySelectorAll('button')].find((b) =>
			b.textContent?.includes('Send again')
		)!;
		again.click();
		await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
		const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(url).toBe('/api/crew/messages');
		expect((init.headers as Record<string, string>)['idempotency-key']).toBe('m2');
		expect(JSON.parse(init.body as string)).toEqual({
			taskId: 'tide',
			kind: 'say',
			text: 'Use Pagefind, please.'
		});
	});

	it('sends what the captain types to the worker, and pauses it with a quick action', async () => {
		show(discussion([]));
		const input = document.querySelector<HTMLTextAreaElement>('[data-discussion-input]')!;
		input.value = 'Keep it static.';
		input.dispatchEvent(new Event('input'));
		flushSync();
		input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
		await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
		expect(JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)).toEqual({
			taskId: 'tide',
			kind: 'say',
			text: 'Keep it static.'
		});
		document.querySelector<HTMLButtonElement>('[data-quick="pause"]')!.click();
		await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
		expect(JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string)).toMatchObject({
			kind: 'pause'
		});
	});

	it('shows the pause, and offers to resume instead', () => {
		show(discussion([said('p1', { kind: 'pause', text: 'Please pause' })], true));
		expect(text()).toContain('You asked tide to stop after its current step');
		expect(document.querySelector('[data-quick="resume"]')).not.toBeNull();
		expect(document.querySelector('[data-quick="pause"]')).toBeNull();
		expect(text()).toContain('Asked to pause');
	});

	it('says why it cannot show a worker’s conversation, and still lets the captain send', () => {
		show(discussion([]));
		FakeSource.last!.emit('session', {
			state: 'unavailable',
			reason: 'Wheelhouse can show a Claude Code worker’s conversation; this one runs Codex.',
			harness: 'codex',
			busy: false
		});
		flushSync();
		expect(text()).toContain('this one runs Codex');
		expect(document.querySelector('[data-discussion-input]')).not.toBeNull();
	});

	it('ends the discussion when asked', async () => {
		const ended = vi.fn();
		app = mount(Discussion, {
			target: document.body,
			props: {
				taskId: 'tide',
				discussion: discussion([]),
				task: taskSummary('tide', 'working'),
				token: 'tok',
				onended: ended
			}
		});
		flushSync();
		document.querySelector<HTMLButtonElement>('[data-end-discussion]')!.click();
		await vi.waitFor(() => expect(ended).toHaveBeenCalled());
		expect(JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)).toEqual({
			taskId: 'tide',
			action: 'close'
		});
	});

	it('is read-only until the captain chats with crew: a greyed box and one button', () => {
		show(null);
		FakeSource.last!.emit('session', {
			state: 'external',
			reason: null,
			harness: 'claude',
			busy: false
		});
		FakeSource.last!.emit('records', [
			{
				type: 'assistant',
				uuid: 'a1',
				timestamp: '2026-11-15T09:02:00.000Z',
				message: {
					id: 'a1',
					role: 'assistant',
					content: [{ type: 'text', text: 'Backoff is in.' }]
				}
			}
		]);
		flushSync();
		expect(text()).toContain('Read-only');
		expect(text()).toContain('Backoff is in.');
		expect(document.querySelector('[data-discussion-input]')).toBeNull();
		expect(document.querySelector('[data-end-discussion]')).toBeNull();
		expect(document.querySelector('[data-quick]')).toBeNull();
		const button = document.querySelector<HTMLButtonElement>('[data-chat-with-crew]')!;
		expect(button.disabled).toBe(false);
		expect(button.closest('[aria-disabled="true"]')).toBeNull();
		expect(text()).toContain('You’ll be asked to confirm first');
	});

	it('warns before it opens a discussion, and opens one only once confirmed', async () => {
		show(null);
		document.querySelector<HTMLButtonElement>('[data-chat-with-crew]')!.click();
		flushSync();
		await vi.waitFor(() => expect(document.body.textContent).toContain('Talk to tide directly?'));
		expect(text()).toContain('Firstmate gets a note of each message');
		expect(fetchMock).not.toHaveBeenCalled();
		document.querySelector<HTMLButtonElement>('[data-crew-confirm]')!.click();
		await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
		const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(url).toBe('/api/crew');
		expect(JSON.parse(init.body as string)).toEqual({ taskId: 'tide', action: 'open' });
	});

	it('offers no discussion with a worker that is not at work', () => {
		show(null, taskSummary('tide', 'landed'));
		expect(document.querySelector<HTMLButtonElement>('[data-chat-with-crew]')!.disabled).toBe(true);
		expect(text()).toContain('Its worker is not at work.');
	});
});
