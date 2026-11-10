import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from '$app/state';
import { firstmateChat } from '$lib/client/chat.svelte';
import { reactions } from '$lib/client/reactions.svelte';

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
	open();
});

/** Mounts the chat afresh, as a reload of the page does. */
const open = () => {
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
};

afterEach(() => {
	unmount(app);
	for (const p of firstmateChat.pending) firstmateChat.dismiss(p.id);
	firstmateChat.records = [];
	firstmateChat.session = null;
	delete (page.data as Record<string, unknown>).messages;
	vi.unstubAllGlobals();
});

const bubbles = () => [...document.querySelectorAll<HTMLElement>('[data-bubble]')];

const touch = (target: Element, type: string, x: number) => {
	const e = new Event(type, { bubbles: true });
	const touches = type === 'touchend' ? [] : [{ clientX: x, clientY: 100 }];
	Object.defineProperty(e, 'touches', { value: touches });
	target.dispatchEvent(e);
};
const swipe = (target: Element) => {
	touch(target, 'touchstart', 10);
	touch(target, 'touchmove', 40);
	touch(target, 'touchmove', 80);
	expect(target.closest<HTMLElement>('[data-bubble]')!.style.transform).toBe(
		firstmateChat.session?.canSend ? 'translateX(70px)' : ''
	);
	touch(target, 'touchend', 80);
	flushSync();
};
const draft = () => document.querySelector('[aria-label="Replying to a message"]');

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

	describe('thumbs-up', () => {
		const thumbs = () =>
			document.querySelector<HTMLButtonElement>('button.thumbs-btn[aria-pressed]')!;
		const sent = () =>
			fetchMock.mock.calls
				.filter(([url]) => url === '/api/firstmate/input')
				.map(([, init]) => JSON.parse((init as RequestInit).body as string).text);
		/** The server's marks, as another device would read them. */
		let server: string[];
		let refuse: boolean;
		/** A fresh page load: the marks come from the server, not from this page. */
		const reload = async () => {
			unmount(app);
			reactions.reset();
			open();
			await vi.waitFor(() =>
				expect(
					fetchMock.mock.calls.filter(([u]) => u === '/api/firstmate/reactions').length
				).toBeGreaterThan(0)
			);
			await Promise.resolve();
			flushSync();
		};
		beforeEach(async () => {
			server = [];
			refuse = false;
			fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
				if (url !== '/api/firstmate/reactions') return new Response('{}', { status: 200 });
				if (init?.method === 'POST') {
					if (refuse) return new Response('{"message":"no"}', { status: 503 });
					const { id, on } = JSON.parse(init.body as string);
					server = on ? [...server.filter((x) => x !== id), id] : server.filter((x) => x !== id);
				}
				return new Response(JSON.stringify({ liked: server }), { status: 200 });
			});
			fetchMock.mockClear();
			await reload();
			fetchMock.mockClear();
		});

		it('marks the message, tells Firstmate which, and the server keeps the mark', async () => {
			expect(thumbs().getAttribute('aria-pressed')).toBe('false');
			thumbs().click();
			flushSync();
			expect(thumbs().getAttribute('aria-pressed')).toBe('true');
			expect(document.querySelector('.thumbs-mark')?.textContent).toBe('👍');
			await vi.waitFor(() =>
				expect(sent()).toEqual(['👍 on: “The scout found it: the 40% growth is the URL polyfill.”'])
			);
			await vi.waitFor(() => expect(server).toHaveLength(1));

			fetchMock.mockClear();
			await reload();
			await vi.waitFor(() => expect(thumbs().getAttribute('aria-pressed')).toBe('true'));
			expect(document.querySelector('.thumbs-mark')).not.toBeNull();
		});

		it('takes the mark back on a second click without sending anything', async () => {
			thumbs().click();
			flushSync();
			await vi.waitFor(() => expect(sent()).toHaveLength(1));
			await vi.waitFor(() => expect(server).toHaveLength(1));
			thumbs().click();
			flushSync();
			expect(thumbs().getAttribute('aria-pressed')).toBe('false');
			expect(document.querySelector('.thumbs-mark')).toBeNull();
			await vi.waitFor(() => expect(server).toEqual([]));
			expect(sent()).toHaveLength(1);
			await reload();
			expect(thumbs().getAttribute('aria-pressed')).toBe('false');
		});

		it('undoes the mark when the server refuses to keep it', async () => {
			refuse = true;
			thumbs().click();
			flushSync();
			expect(thumbs().getAttribute('aria-pressed')).toBe('true');
			await vi.waitFor(() => expect(thumbs().getAttribute('aria-pressed')).toBe('false'));
			expect(server).toEqual([]);
		});
	});

	it('offers no reply while Firstmate cannot be messaged', () => {
		firstmateChat.session = { ...firstmateChat.session!, state: 'none', canSend: false };
		flushSync();
		expect(document.querySelector('.reply-btn')).toBeNull();
		expect(document.querySelector('.thumbs-btn')).toBeNull();
	});

	describe('swiping a bubble', () => {
		const scout = () => bubbles().find((b) => b.textContent?.startsWith('The scout'))!;

		it('starts a reply when a Firstmate bubble is swiped right', () => {
			swipe(scout());
			expect(draft()?.textContent).toMatch(/40% growth is the URL polyfill/);
		});

		it('leaves a sideways scroll inside a wide code block alone', () => {
			const pre = document.createElement('pre');
			pre.style.overflowX = 'auto';
			pre.innerHTML = '<code>wide</code>';
			Object.defineProperty(pre, 'scrollWidth', { value: 900 });
			Object.defineProperty(pre, 'clientWidth', { value: 300 });
			scout().append(pre);
			const code = pre.firstElementChild!;
			touch(code, 'touchstart', 10);
			touch(code, 'touchmove', 80);
			expect(scout().style.transform).toBe('');
			touch(code, 'touchend', 80);
			flushSync();
			expect(draft()).toBeNull();
		});

		it('does not move, buzz or start a reply while Firstmate cannot be messaged', () => {
			const vibrate = vi.fn();
			Object.defineProperty(navigator, 'vibrate', { value: vibrate, configurable: true });
			firstmateChat.session = { ...firstmateChat.session!, state: 'none', canSend: false };
			flushSync();
			swipe(scout());
			expect(vibrate).not.toHaveBeenCalled();
			expect(draft()).toBeNull();
		});
	});
});

describe('decision forms in the conversation', () => {
	const ASK =
		'Two ways to go.\n\n```decision-form\nWhich should ship?\n- Welcome page, tour behind a link: a link opens it (recommended)\n- Welcome page only\n- (written)\n```';
	const MERGE = 'Checks are green.\n\n```decision-form\nMerge it now?\n- Merge\n- Not yet\n```';
	const show = (...records: ReturnType<typeof record>[]) => {
		firstmateChat.records = [captain('u1', '10', 'How should onboarding work?'), ...records];
		flushSync();
	};
	const forms = () => [...document.querySelectorAll<HTMLElement>('[data-chat-form]')];
	const sentText = () => {
		const [, init] = fetchMock.mock.calls.find(([url]) => url === '/api/firstmate/input')!;
		return JSON.parse((init as RequestInit).body as string).text;
	};

	it('shows a reply’s form as controls under its words, not as the raw block', () => {
		show(firstmate('a1', '11', ASK));
		const bubble = bubbles().find((b) => b.dataset.bubble === 'a1-t')!;
		expect(bubble.textContent!.trim()).toBe('Two ways to go.');
		expect(document.body.textContent).not.toContain('decision-form');
		const [form] = forms();
		expect(form.dataset.chatForm).toBe('open');
		expect(form.textContent).toContain('Which should ship?');
		expect(form.querySelectorAll('input[type="radio"]')).toHaveLength(2);
	});

	it('sends the pick as the captain’s message, then shows what was decided', async () => {
		show(firstmate('a1', '11', MERGE));
		const merge = [...forms()[0].querySelectorAll('button')].find((b) =>
			b.textContent!.startsWith('Merge')
		)!;
		merge.click();
		flushSync();
		await vi.waitFor(() => expect(sentText()).toBe('Decided: Merge — for: “Merge it now?”'));
		const [form] = forms();
		expect(form.dataset.chatForm).toBe('answered');
		expect(form.querySelector('[data-decided]')!.textContent).toContain('You decided Merge');
		expect(form.querySelector('button')).toBeNull();
	});

	it('reads what was decided back from the transcript', () => {
		show(
			firstmate('a1', '11', MERGE),
			captain('u2', '12', 'Decided: Not yet — for: “Merge it now?”')
		);
		const [form] = forms();
		expect(form.dataset.chatForm).toBe('answered');
		expect(form.querySelector('[data-decided]')!.textContent).toContain('You decided Not yet');
	});

	describe('stays answered after Firstmate’s next turn, and after a reload', () => {
		const ended = (id: string, at: string) =>
			record(id, at, { type: 'system', subtype: 'turn_duration', durationMs: 1000 });
		const answered = () => {
			const [form] = forms();
			expect(form.dataset.chatForm).toBe('answered');
			expect(form.querySelector('[data-decided]')!.textContent).toContain('You decided Merge');
		};

		it('from the transcript, for an answer typed into the session', () => {
			show(
				firstmate('a1', '11', MERGE),
				ended('d1', '11'),
				captain('u2', '12', 'Decided: Merge — for: “Merge it now?”'),
				firstmate('a2', '13', 'Merging now.')
			);
			answered();
			unmount(app);
			open();
			answered();
		});

		it('from Wheelhouse’s record of the inbox note, for an answer sent there', () => {
			(page.data as Record<string, unknown>).messages = {
				messages: [
					{
						requestId: 'wh-1',
						text: 'Decided: Merge — for: “Merge it now?”',
						taskId: null,
						submittedAt: '2026-10-30T16:12:00.000Z',
						delivery: 'delivered',
						deliveryDetail: null,
						acknowledged: true,
						noteId: 'n1',
						reply: null
					}
				]
			};
			show(firstmate('a1', '11', MERGE), ended('d1', '11'), firstmate('a2', '13', 'Merging now.'));
			answered();
			unmount(app);
			open();
			answered();
		});
	});

	it('sends a written answer in the captain’s words', async () => {
		show(firstmate('a1', '11', '```decision-form\nWhich browsers?\n- (written)\n```'));
		expect(bubbles().find((b) => b.dataset.bubble === 'a1-t')).toBeUndefined();
		const box = forms()[0].querySelector('textarea')!;
		box.value = 'The last two years';
		box.dispatchEvent(new Event('input'));
		flushSync();
		forms()[0]
			.querySelector('form')!
			.dispatchEvent(new Event('submit', { cancelable: true }));
		await vi.waitFor(() =>
			expect(sentText()).toBe('Decided: The last two years — for: “Which browsers?”')
		);
	});

	it('keeps an earlier form answerable on its own once a later one is asked', async () => {
		show(firstmate('a1', '11', ASK), firstmate('a2', '12', MERGE));
		const [earlier, latest] = forms();
		expect(earlier.dataset.chatForm).toBe('open');
		expect(latest.dataset.chatForm).toBe('open');
		const only = [...earlier.querySelectorAll<HTMLInputElement>('input[type="radio"]')][1];
		only.click();
		flushSync();
		const decide = [...earlier.querySelectorAll('button')].find((b) =>
			b.textContent!.trim().startsWith('Decide')
		)!;
		decide.click();
		flushSync();
		await vi.waitFor(() =>
			expect(sentText()).toBe('Decided: Welcome page only — for: “Which should ship?”')
		);
		await vi.waitFor(() => expect(forms()[0].dataset.chatForm).toBe('answered'));
		expect(forms()[1].dataset.chatForm).toBe('open');
	});

	it('leaves a later form in the same turn open when a queued answer to an earlier one lands', () => {
		show(
			firstmate('a1', '11', ASK),
			firstmate('a2', '11', MERGE),
			captain('u2', '12', 'Decided: Welcome page only — for: “Which should ship?”')
		);
		const [earlier, latest] = forms();
		expect(earlier.dataset.chatForm).toBe('answered');
		expect(earlier.querySelector('[data-decided]')!.textContent).toContain(
			'You decided Welcome page only'
		);
		expect(latest.dataset.chatForm).toBe('open');
		expect([...latest.querySelectorAll('button')].some((b) => !b.disabled)).toBe(true);
	});

	it('closes a form a later one with the same question replaced', () => {
		show(firstmate('a1', '11', MERGE), firstmate('a2', '12', `Still green.\n\n${MERGE}`));
		const [replaced, latest] = forms();
		expect(replaced.dataset.chatForm).toBe('replaced');
		expect(replaced.textContent).toContain('A later question from Firstmate replaced this one.');
		expect(
			[...replaced.querySelectorAll<HTMLInputElement | HTMLButtonElement>('input, button')].every(
				(c) => c.disabled
			)
		).toBe(true);
		expect(latest.dataset.chatForm).toBe('open');
	});

	it('opens the form again when an answer that failed to send is dismissed', async () => {
		fetchMock.mockImplementation(async () => new Response('{"error":"down"}', { status: 500 }));
		show(firstmate('a1', '11', MERGE));
		[...forms()[0].querySelectorAll('button')]
			.find((b) => b.textContent!.startsWith('Merge'))!
			.click();
		flushSync();
		await vi.waitFor(() => expect(firstmateChat.pending[0]?.state).toBe('failed'));
		flushSync();
		firstmateChat.dismiss(firstmateChat.pending[0].id);
		flushSync();
		expect(forms()[0].dataset.chatForm).toBe('open');
	});

	it('keeps an example block earlier in the reply in its words', () => {
		show(
			firstmate(
				'a1',
				'11',
				`Like this:\n\n\`\`\`decision-form\nReady?\n- Yes\n- No\n\`\`\`\n\n${MERGE}`
			)
		);
		const bubble = bubbles().find((b) => b.dataset.bubble === 'a1-t')!;
		expect(bubble.textContent).toContain('Ready?');
		expect(bubble.textContent).toContain('Checks are green.');
		expect(forms()).toHaveLength(1);
		expect(forms()[0].textContent).toContain('Merge it now?');
	});

	it('cannot be answered while a Claude Code menu is open in the session', () => {
		show(firstmate('a1', '11', MERGE));
		firstmateChat.session = { ...firstmateChat.session!, menu: { title: 'Manage MCP servers' } };
		flushSync();
		expect([...forms()[0].querySelectorAll('button')].every((b) => b.disabled)).toBe(true);
	});

	it('leaves a block that does not end the reply as it is written', () => {
		show(firstmate('a1', '11', `${MERGE}\n\nThat is how a form looks.`));
		expect(forms()).toHaveLength(0);
	});
});
