import { flushSync, mount, tick, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { firstmateChat } from '$lib/client/chat.svelte';

vi.mock('$app/state', () => ({ page: { data: {} } }));

const { default: Chat } = await import('./Chat.svelte');

/** Plainly fake, and never token-shaped. */
const FAKE_VALUE = 'not-a-real-value-5d0e';

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

const ASKING = [
	'Lumen needs its deploy token before I can ship.',
	'',
	'```vault-request',
	'name: VERCEL_TOKEN',
	'purpose: Deploy lumen to production',
	'projects: lumen',
	'```'
].join('\n');
const NOT_A_REQUEST = '```vault-request\nname: VERCEL_TOKEN\nvalue: leaked\n```';

let app: ReturnType<typeof mount>;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
	fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
		if (url === '/api/vault' && init?.method === 'POST') {
			return new Response(
				JSON.stringify({
					message: 'Stored VERCEL_TOKEN in your Mac’s login Keychain. lumen can use it.',
					secrets: [{ name: 'VERCEL_TOKEN', projects: ['lumen'], updatedAt: 'x', lastUsedAt: null }]
				})
			);
		}
		if (url === '/api/vault') return new Response(JSON.stringify({ canStore: true, reason: null }));
		return new Response('{}', { status: 200 });
	});
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
		captain('u1', '10', 'Ship lumen please.'),
		firstmate('a1', '11', ASKING),
		record('d1', '11', { type: 'system', subtype: 'turn_duration', durationMs: 1000 }),
		captain('u2', '12', 'And this one?'),
		firstmate('a2', '13', NOT_A_REQUEST),
		record('d2', '13', { type: 'system', subtype: 'turn_duration', durationMs: 1000 })
	];
	document.body.innerHTML = '';
	app = mount(Chat, {
		target: document.body,
		props: {
			token: 't',
			railOpen: false,
			onToggleRail: () => {},
			health: { label: 'All quiet', tone: 'success' },
			now: Date.parse('2026-11-09T09:30:00Z'),
			projects: [
				{ id: 'lumen', name: 'lumen' },
				{ id: 'atlas', name: 'atlas' }
			] as never
		}
	});
	flushSync();
});

afterEach(() => {
	unmount(app);
	for (const p of firstmateChat.pending) firstmateChat.dismiss(p.id);
	firstmateChat.records = [];
	firstmateChat.session = null;
	vi.unstubAllGlobals();
});

const settle = async () => {
	for (let i = 0; i < 5; i++) {
		await new Promise((r) => setTimeout(r, 0));
		await tick();
	}
	flushSync();
};
const valueField = () => document.getElementById('vault-add-value') as HTMLInputElement | null;
const card = () => document.querySelector<HTMLElement>('[data-vault-request]');

describe('secrets Firstmate asks for in the chat', () => {
	it('shows a request as a card under the reply, without its block, and opens nothing by itself', () => {
		const bubble = [...document.querySelectorAll('[data-bubble]')].find((b) =>
			b.getAttribute('data-bubble')?.startsWith('a1')
		)!;
		expect(bubble.textContent).toMatch(/needs its deploy token/);
		expect(bubble.textContent).not.toMatch(/vault-request|name:/);
		expect(card()!.dataset.vaultRequest).toBe('open');
		expect(card()!.textContent).toMatch(/Firstmate asks for VERCEL_TOKEN/);
		expect(card()!.textContent).toMatch(/Deploy lumen to production/);
		expect(valueField()).toBeNull();
		expect(fetchMock.mock.calls.some(([u]) => u === '/api/vault')).toBe(false);
	});

	it('shows a block it cannot read as the ordinary text it is', () => {
		expect(document.querySelectorAll('[data-vault-request]').length).toBe(1);
		const code = [...document.querySelectorAll('[data-bubble] code')].find((c) =>
			c.textContent?.includes('value: leaked')
		);
		expect(code).toBeTruthy();
	});

	it('opens the popup filled in from the card, and tells Firstmate only the name once stored', async () => {
		[...card()!.querySelectorAll('button')]
			.find((b) => b.textContent === 'Add VERCEL_TOKEN…')!
			.click();
		flushSync();
		await settle();
		expect((document.getElementById('vault-add-name') as HTMLInputElement).value).toBe(
			'VERCEL_TOKEN'
		);
		const field = valueField()!;
		field.value = FAKE_VALUE;
		field.dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
		document
			.querySelector('[data-vault-add] form')!
			.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
		await settle();
		const sent = fetchMock.mock.calls
			.filter(([u]) => u === '/api/firstmate/input')
			.map(([, init]) => JSON.parse((init as RequestInit).body as string).text);
		expect(sent).toEqual(['Stored secret VERCEL_TOKEN in the vault. lumen can use it.']);
		expect(valueField()).toBeNull();
		expect(document.body.innerHTML).not.toContain(FAKE_VALUE);
		expect(JSON.stringify(firstmateChat.pending)).not.toContain(FAKE_VALUE);
		// The note answers the request.
		expect(card()!.dataset.vaultRequest).toBe('stored');
	});

	it('opens a blank popup from the key button', async () => {
		document.querySelector<HTMLButtonElement>('[aria-label="Add a secret to the vault"]')!.click();
		flushSync();
		await settle();
		expect((document.getElementById('vault-add-name') as HTMLInputElement).value).toBe('');
		expect(valueField()!.type).toBe('password');
	});
});
