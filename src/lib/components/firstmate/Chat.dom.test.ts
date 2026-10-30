import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { firstmateChat } from '$lib/client/chat.svelte';

vi.mock('$app/state', () => ({ page: { data: {} } }));

const { default: Chat } = await import('./Chat.svelte');

const record = (uuid: string, at: string, rest: Record<string, unknown>) => ({
	uuid,
	timestamp: `2026-10-30T16:${at}:00.000Z`,
	sessionId: 's',
	...rest
});
const captain = (uuid: string, at: string, content: string) =>
	record(uuid, at, { type: 'user', message: { role: 'user', content } });
const firstmate = (uuid: string, at: string, text: string) =>
	record(uuid, at, {
		type: 'assistant',
		message: { id: uuid, role: 'assistant', content: [{ type: 'text', text }] }
	});

const REPLY =
	'> Replying to Firstmate: “The scout found it: the 40% growth is the URL polyfill.”\n\nGood find. Does it break anyone?';

let app: ReturnType<typeof mount>;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
	fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
	vi.stubGlobal('fetch', fetchMock);
	Element.prototype.scrollIntoView = vi.fn();
	firstmateChat.session = {
		schema: 'wheelhouse-firstmate-session.v1',
		state: 'ours',
		reason: null,
		canSend: true,
		attach: null,
		skipPermissions: false,
		picker: null,
		menu: null,
		busy: false
	};
	firstmateChat.records = [
		captain('u1', '10', 'Why did the bundle grow?'),
		firstmate('a1', '11', 'The scout found it: the **40% growth is the URL polyfill**.'),
		record('d1', '11', { type: 'system', subtype: 'turn_duration', durationMs: 1000 }),
		captain('u2', '20', REPLY)
	];
	document.body.innerHTML = '';
	app = mount(Chat, {
		target: document.body,
		props: {
			token: 't',
			railOpen: false,
			onToggleRail: () => {},
			health: { label: 'All quiet', tone: 'success' },
			now: Date.parse('2026-10-30T16:30:00Z')
		}
	});
	flushSync();
});

afterEach(() => {
	unmount(app);
	firstmateChat.records = [];
	firstmateChat.session = null;
	vi.unstubAllGlobals();
});

const bubbles = () => [...document.querySelectorAll<HTMLElement>('[data-bubble]')];

describe('replies in the chat', () => {
	it('shows a sent reply as its quote and the captain’s words, not raw quote text', () => {
		const reply = bubbles().find((b) => b.dataset.bubble === 'u2')!;
		const quote = reply.querySelector<HTMLButtonElement>('.reply-quote')!;
		expect(quote.textContent).toMatch(/Firstmate/);
		expect(quote.textContent).toMatch(/40% growth is the URL polyfill/);
		expect(reply.textContent).toMatch(/Good find\. Does it break anyone\?$/);
		expect(reply.textContent).not.toMatch(/Replying to/);
	});

	it('takes the captain back to the quoted message and lights it up', async () => {
		const reply = bubbles().find((b) => b.dataset.bubble === 'u2')!;
		const quote = reply.querySelector<HTMLButtonElement>('.reply-quote')!;
		expect(quote.disabled).toBe(false);
		quote.click();
		const original = bubbles().find((b) => b.textContent?.startsWith('The scout'))!;
		expect(original.scrollIntoView).toHaveBeenCalled();
		await vi.waitFor(() => expect(original.classList.contains('reply-flash')).toBe(true));
	});

	it('starts a reply from a message’s Reply button and sends it with the quote', async () => {
		const button = document.querySelector<HTMLButtonElement>(
			'button[aria-label="Reply to this message from Firstmate"]'
		)!;
		button.click();
		flushSync();
		const draft = document.querySelector('[aria-label="Replying to a message"]');
		expect(draft?.textContent).toMatch(/The scout found it: the 40% growth is the URL polyfill\./);

		const editor = document.querySelector<HTMLElement>('[role="textbox"]')!;
		editor.textContent = 'Queue it for 3.0.';
		editor.dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
		editor.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
		);
		await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
		const [, init] = fetchMock.mock.calls.find(([url]) => url === '/api/firstmate/input')!;
		expect(JSON.parse((init as RequestInit).body as string).text).toBe(
			'> Replying to Firstmate: “The scout found it: the 40% growth is the URL polyfill.”\n\nQueue it for 3.0.'
		);
		flushSync();
		expect(document.querySelector('[aria-label="Replying to a message"]')).toBeNull();
	});

	it('offers no reply while Firstmate cannot be messaged', () => {
		firstmateChat.session = { ...firstmateChat.session!, state: 'none', canSend: false };
		flushSync();
		expect(document.querySelector('.reply-btn')).toBeNull();
	});
});
