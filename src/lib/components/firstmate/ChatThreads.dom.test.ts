import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { aliases } from '$lib/client/aliases.svelte';
import { firstmateChat } from '$lib/client/chat.svelte';
import type { Project, TaskSummary } from '$lib/types';
import { taskSummary } from '../../../../tests/helpers/task-summary';

// The page's data, as each test sets it: lanes are the experimental `lanes` feature.
const state = vi.hoisted(() => ({ page: { data: {} as Record<string, unknown> } }));
vi.mock('$app/state', () => state);

const { default: Chat } = await import('./Chat.svelte');

const record = (uuid: string, at: string, rest: Record<string, unknown>) => ({
	uuid,
	timestamp: `2026-11-09T09:${at}:00.000Z`,
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
const done = (uuid: string, at: string) =>
	record(uuid, at, { type: 'system', subtype: 'turn_duration', durationMs: 1000 });

const project = (id: string): Project => ({
	id,
	name: id,
	description: null,
	posture: null,
	registered: true,
	path: null,
	passage: null
});

let app: ReturnType<typeof mount>;
let fetchMock: ReturnType<typeof vi.fn>;
const pick = vi.fn();

const open = (
	thread: string | null,
	{ now = '09:30', tasks = [] }: { now?: string; tasks?: TaskSummary[] } = {}
) => {
	document.body.innerHTML = '';
	app = mount(Chat, {
		target: document.body,
		props: {
			token: 't',
			railOpen: false,
			onToggleRail: () => {},
			health: { label: 'All quiet', tone: 'success' },
			now: Date.parse(`2026-11-09T${now}:00Z`),
			projects: [project('tidepool'), project('lumen')],
			tasks,
			thread,
			onPickThread: pick
		}
	});
	flushSync();
};

/** Types a message into the box and sends it; resolves with the text Firstmate receives. */
async function send(words: string): Promise<string> {
	const editor = document.querySelector<HTMLElement>('[role="textbox"]')!;
	editor.textContent = words;
	editor.dispatchEvent(new Event('input', { bubbles: true }));
	flushSync();
	editor.dispatchEvent(
		new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
	);
	await vi.waitFor(() =>
		expect(fetchMock.mock.calls.some(([url]) => url === '/api/firstmate/input')).toBe(true)
	);
	const [, init] = fetchMock.mock.calls.find(([url]) => url === '/api/firstmate/input')!;
	return JSON.parse((init as RequestInit).body as string).text as string;
}

beforeEach(() => {
	state.page.data = {};
	pick.mockClear();
	fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
	vi.stubGlobal('fetch', fetchMock);
	Element.prototype.scrollIntoView = vi.fn();
	localStorage.clear();
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
		captain('u1', '01', '[project tidepool] Never retry a POST.'),
		firstmate('a1', '02', '<!-- project: tidepool -->\nDone, it is a hard requirement now.'),
		done('d1', '02'),
		captain('u2', '05', 'morning'),
		firstmate(
			'a2',
			'06',
			'Round-up:\n\n<!-- project: lumen -->\nShare links are green.\n\n<!-- project: tidepool -->\nThe scout is back.'
		),
		done('d2', '06')
	];
});

afterEach(() => {
	unmount(app);
	aliases.names = {};
	for (const p of firstmateChat.pending) firstmateChat.dismiss(p.id);
	firstmateChat.records = [];
	firstmateChat.session = null;
	vi.unstubAllGlobals();
});

const bubble = (id: string) => document.querySelector<HTMLElement>(`[data-bubble="${id}"]`);
const tags = () => [...document.querySelectorAll('.thread-tag')].map((t) => t.textContent?.trim());

describe('threads in the chat', () => {
	it('tags every message, and shows a message without the thread it was sent in', () => {
		open(null);
		expect(bubble('u1')!.textContent).toBe('Never retry a POST.');
		expect(bubble('a1-t')!.textContent).not.toContain('project:');
		expect(tags()).toEqual(['tidepool', 'tidepool', 'Unsorted', 'lumen', 'tidepool']);
		expect(document.querySelector('[data-thread-note]')).toBeNull();
	});

	it('shows only the thread being read, a round-up only its part about it', () => {
		open('tidepool');
		expect(document.querySelector('[data-thread-note]')!.textContent!.replace(/\s+/g, ' ')).toMatch(
			/tidepool thread: 3 of 4 messages/
		);
		expect(bubble('u2')).toBeNull();
		const roundup = bubble('a2-t')!;
		expect(roundup.textContent).toContain('Round-up:');
		expect(roundup.textContent).toContain('The scout is back.');
		expect(roundup.textContent).not.toContain('Share links');
		expect(
			document.querySelector('[data-other-threads]')!.textContent!.replace(/\s+/g, ' ')
		).toMatch(/1 part about other threads/);
		[...document.querySelectorAll<HTMLButtonElement>('[data-thread-note] button')]
			.find((b) => b.textContent === 'Show all threads')!
			.click();
		expect(pick).toHaveBeenCalledWith(null);
	});

	it('folds the other threads to a line that opens in place', () => {
		open('lumen');
		document.querySelector<HTMLInputElement>('[data-thread-note] input')!.click();
		flushSync();
		const fold = document.querySelector<HTMLButtonElement>('.thread-fold')!;
		expect(fold.textContent).toMatch(/3 messages about/);
		expect(bubble('u1')).toBeNull();
		fold.click();
		flushSync();
		expect(bubble('u1')!.closest('.thread-dim')).not.toBeNull();
	});

	it('sends a message in the thread being read', async () => {
		open('lumen');
		expect(document.querySelector('[data-send-in]')!.textContent).toMatch(/Sent in\s*lumen/);
		const editor = document.querySelector<HTMLElement>('[role="textbox"]')!;
		editor.textContent = 'ship it';
		editor.dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
		editor.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
		);
		await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
		const [, init] = fetchMock.mock.calls.find(([url]) => url === '/api/firstmate/input')!;
		expect(JSON.parse((init as RequestInit).body as string).text).toBe('[project lumen] ship it');
	});

	it('sends a message starting with #<thread> there instead', async () => {
		open('lumen');
		const editor = document.querySelector<HTMLElement>('[role="textbox"]')!;
		editor.textContent = '#tidepool and the scout?';
		editor.dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
		editor.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
		);
		await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
		const [, init] = fetchMock.mock.calls.find(([url]) => url === '/api/firstmate/input')!;
		expect(JSON.parse((init as RequestInit).body as string).text).toBe(
			'[project tidepool] and the scout?'
		);
	});
	it('keeps a message out of the thread when the thread list changes', async () => {
		open('lumen');
		document
			.querySelector<HTMLButtonElement>('[aria-label="Send this message in no thread"]')!
			.click();
		flushSync();
		aliases.set('lumen', 'Lumen app');
		flushSync();
		expect(document.querySelector('[data-send-in]')!.textContent).toMatch(/Sent in no thread/);
		const editor = document.querySelector<HTMLElement>('[role="textbox"]')!;
		editor.textContent = 'just thinking';
		editor.dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
		editor.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
		);
		await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
		const [, init] = fetchMock.mock.calls.find(([url]) => url === '/api/firstmate/input')!;
		expect(JSON.parse((init as RequestInit).body as string).text).toBe('just thinking');
	});

	it('shows a round-up that ends in a form whole, with its form, in each of its threads', () => {
		firstmateChat.records = [
			firstmate(
				'a3',
				'07',
				'Two calls:\n\n<!-- project: lumen -->\nShip the share links?\n\n<!-- project: tidepool -->\nKeep the retries?\n\n```decision-form\nWhich first?\n- Lumen\n- Tidepool\n```'
			),
			done('d3', '07')
		];
		for (const [i, t] of ['lumen', 'tidepool'].entries()) {
			if (i) unmount(app);
			open(t);
			const reply = bubble('a3-t')!;
			expect(reply.textContent).toContain('Ship the share links?');
			expect(reply.textContent).toContain('Keep the retries?');
			expect(document.querySelector('[data-chat-form]')!.textContent).toContain('Which first?');
		}
	});

	it('tags a round-up that ends in a form with each of its threads in the All view', () => {
		firstmateChat.records = [
			firstmate(
				'a3',
				'07',
				'Two calls:\n\n<!-- project: lumen -->\nShip the share links?\n\n<!-- project: tidepool -->\nKeep the retries?\n\n```decision-form\nWhich first?\n- Lumen\n- Tidepool\n```'
			),
			done('d3', '07')
		];
		open(null);
		expect(tags()).toEqual(['lumen', 'tidepool']);
		const reply = bubble('a3-t')!;
		expect(reply.textContent).toContain('Two calls:');
		expect(reply.textContent).toContain('Ship the share links?');
		expect(reply.textContent).toContain('Keep the retries?');
		expect(reply.textContent).not.toContain('decision-form');
		expect(document.querySelector('[data-chat-form]')!.textContent).toContain('Which first?');
	});

	it('shows a tag’s thread from its name, and keeps moving the message to its caret', () => {
		open(null);
		const lumen = [...document.querySelectorAll<HTMLButtonElement>('.thread-tag-show')].find(
			(b) => b.textContent?.trim() === 'lumen'
		)!;
		lumen.click();
		expect(pick).toHaveBeenCalledWith('lumen');
		expect(document.querySelectorAll('.thread-tag-move').length).toBe(5);
	});

	it('sends a reply in the thread of the message it answers', async () => {
		open(null);
		bubble('a1-t')!.closest('.bubble-row')!.querySelector<HTMLButtonElement>('.reply-btn')!.click();
		flushSync();
		expect(document.querySelector('[data-send-in]')!.textContent!.replace(/\s+/g, ' ')).toMatch(
			/Sent in tidepool.*from the message you’re replying to/
		);
		expect(await send('make it a lint rule')).toBe(
			'> Replying to Firstmate: “Done, it is a hard requirement now.”\n\n[project tidepool] make it a lint rule'
		);
	});

	describe('with lanes on', () => {
		beforeEach(() => {
			state.page.data = { features: { lanes: true } };
		});

		it('shows a lane per thread over the chat, and picks one from it or from ⌥ and a digit', () => {
			open(null);
			const lanes = [...document.querySelectorAll<HTMLButtonElement>('[data-lanes] .lane')];
			expect(lanes.map((l) => l.querySelector('.lane-name')?.textContent ?? 'All')).toEqual([
				'All',
				'lumen',
				'tidepool',
				'Unsorted'
			]);
			lanes[2].click();
			expect(pick).toHaveBeenCalledWith('tidepool');
			window.dispatchEvent(
				new KeyboardEvent('keydown', { code: 'Digit1', altKey: true, bubbles: true })
			);
			expect(pick).toHaveBeenLastCalledWith('lumen');
			window.dispatchEvent(
				new KeyboardEvent('keydown', { code: 'Digit0', altKey: true, bubbles: true })
			);
			expect(pick).toHaveBeenLastCalledWith(null);
		});

		it('sends a message in the thread of the last one while it is fresh, and says so', async () => {
			open(null, { now: '09:10' });
			expect(document.querySelector('[data-send-in]')!.textContent!.replace(/\s+/g, ' ')).toMatch(
				/Sent in tidepool.*carries on from the/
			);
			expect(await send('and the lumen links?')).toBe('[project tidepool] and the lumen links?');
		});

		it('carries no thread on once the last message is older than a quarter of an hour', () => {
			open(null, { now: '09:30' });
			expect(document.querySelector('[data-send-in]')).toBeNull();
		});

		it('narrows a lane to one of its tasks, and sends in that task', async () => {
			firstmateChat.records = [
				firstmate('a1', '01', '<!-- project: tidepool/tp-retries -->\nRetries are off for POSTs.'),
				done('d1', '01'),
				firstmate('a2', '02', '<!-- project: tidepool -->\nThe scout is back.'),
				done('d2', '02')
			];
			const retries = taskSummary('tp-retries', 'with-firstmate', {
				projectId: 'tidepool',
				shortTitle: 'No POST retries'
			});
			open('tidepool', { tasks: [retries] });
			const chips = [...document.querySelectorAll<HTMLButtonElement>('[data-lane-tasks] button')];
			expect(chips.map((c) => c.textContent?.trim())).toEqual([
				'All of tidepool',
				'No POST retries',
				'General'
			]);
			chips[1].click();
			flushSync();
			expect(bubble('a1-t')).not.toBeNull();
			expect(bubble('a2-t')).toBeNull();
			expect(await send('ship it')).toBe('[project tidepool/tp-retries] ship it');
		});
	});
});
