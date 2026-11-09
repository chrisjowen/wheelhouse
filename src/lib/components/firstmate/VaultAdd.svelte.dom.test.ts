import { flushSync, mount, tick, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { VaultRequest } from '$lib/chat/vaultrequest';

const { default: VaultAdd } = await import('./VaultAdd.svelte');

/** Plainly fake, and never token-shaped. */
const FAKE_VALUE = 'not-a-real-value-91c2';

let app: ReturnType<typeof mount> | null = null;
afterEach(() => {
	if (app) unmount(app);
	app = null;
	document.body.innerHTML = '';
	vi.unstubAllGlobals();
});

const settle = async () => {
	for (let i = 0; i < 5; i++) {
		await new Promise((r) => setTimeout(r, 0));
		await tick();
	}
	flushSync();
};
const input = (id: string) => document.getElementById(id) as HTMLInputElement | null;
const type = (el: HTMLInputElement, v: string) => {
	el.value = v;
	el.dispatchEvent(new Event('input', { bubbles: true }));
	flushSync();
};
const button = (text: string) =>
	[...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === text);
const box = (label: string) =>
	[...document.querySelectorAll('label')]
		.find((l) => l.textContent?.trim() === label)!
		.querySelector('input') as HTMLInputElement;
const submit = () => {
	document
		.querySelector('[data-vault-add] form')!
		.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
	flushSync();
};
/** Nothing in the page holds the value: no field, no attribute, no text. */
const valueGone = () => {
	expect(document.body.innerHTML).not.toContain(FAKE_VALUE);
	for (const el of document.querySelectorAll('input')) expect(el.value).not.toContain(FAKE_VALUE);
};

/** A fetch that answers GET /api/vault with `status` and each POST with the next of `posts`. */
function server(posts: [number, object][], status: object = { canStore: true, reason: null }) {
	const fn = vi.fn(async (_url: string, init?: RequestInit) => {
		if (!init?.method || init.method === 'GET') return new Response(JSON.stringify(status));
		const [code, body] = posts.shift() ?? [500, {}];
		return new Response(JSON.stringify(body), { status: code });
	});
	vi.stubGlobal('fetch', fn);
	return fn;
}
const posted = (fn: ReturnType<typeof server>) =>
	fn.mock.calls
		.filter(([, init]) => init?.method === 'POST')
		.map(([, init]) => ({
			headers: init!.headers as Record<string, string>,
			body: JSON.parse(init!.body as string)
		}));

const ASK: VaultRequest = {
	name: 'VERCEL_TOKEN',
	purpose: 'Deploy lumen to production',
	projects: ['lumen', 'elsewhere']
};

function show(o: { ask?: VaultRequest | null; onstored?: (n: string, p: string[]) => void } = {}) {
	const props = $state({
		open: true,
		ask: o.ask ?? null,
		projects: ['atlas', 'lumen'],
		token: 'session-token',
		onstored: o.onstored
	});
	app = mount(VaultAdd, { target: document.body, props });
	flushSync();
	return props;
}

describe('the chat’s Add a secret popup', () => {
	it('fills in what Firstmate asked for: name, why and the projects Wheelhouse knows', async () => {
		server([]);
		show({ ask: ASK });
		await settle();
		expect(input('vault-add-name')!.value).toBe('VERCEL_TOKEN');
		expect(document.querySelector('[data-vault-purpose]')!.textContent).toBe(
			'Deploy lumen to production'
		);
		expect(box('lumen').checked).toBe(true);
		expect(box('atlas').checked).toBe(false);
		expect(document.body.textContent).toMatch(/Firstmate also named elsewhere/);
		// The value field is hidden and starts empty.
		expect(input('vault-add-value')!.type).toBe('password');
		expect(input('vault-add-value')!.value).toBe('');
	});

	it('stores with the session token, then forgets the value and tells the chat only the name', async () => {
		const fn = server([
			[
				200,
				{
					message: 'Stored VERCEL_TOKEN in your Mac’s login Keychain. lumen can use it.',
					secrets: [{ name: 'VERCEL_TOKEN', projects: ['lumen'], updatedAt: 'x', lastUsedAt: null }]
				}
			]
		]);
		const onstored = vi.fn();
		const props = show({ ask: ASK, onstored });
		await settle();
		type(input('vault-add-value')!, FAKE_VALUE);
		submit();
		await settle();
		expect(posted(fn)).toEqual([
			{
				headers: expect.objectContaining({ 'x-wheelhouse-session': 'session-token' }),
				body: {
					action: 'set',
					name: 'VERCEL_TOKEN',
					value: FAKE_VALUE,
					projects: ['lumen'],
					replace: false
				}
			}
		]);
		expect(onstored).toHaveBeenCalledWith('VERCEL_TOKEN', ['lumen']);
		expect(JSON.stringify(onstored.mock.calls)).not.toContain(FAKE_VALUE);
		expect(props.open).toBe(false);
		expect(input('vault-add-value')).toBeNull();
		valueGone();
	});

	it('asks before replacing a name already stored, forgetting the value until it is typed again', async () => {
		const fn = server([
			[
				409,
				{
					message:
						'The vault already has a secret named VERCEL_TOKEN. Storing this replaces its value.'
				}
			],
			[200, { message: 'Replaced the value of VERCEL_TOKEN.', secrets: [] }]
		]);
		const onstored = vi.fn();
		show({ ask: ASK, onstored });
		await settle();
		type(input('vault-add-value')!, FAKE_VALUE);
		submit();
		await settle();
		expect(onstored).not.toHaveBeenCalled();
		expect(document.querySelector('[role="alert"]')!.textContent!.trim()).toBe(
			'A secret named VERCEL_TOKEN already exists. Replace it?'
		);
		expect(input('vault-add-value')?.value ?? '').toBe('');
		valueGone();
		expect(button('Cancel')).toBeTruthy();
		button('Replace')!.click();
		flushSync();
		await settle();
		expect(input('vault-add-value')!.type).toBe('password');
		expect(input('vault-add-value')!.value).toBe('');
		type(input('vault-add-value')!, FAKE_VALUE);
		expect(button('Replace its value')).toBeTruthy();
		submit();
		await settle();
		expect(posted(fn).map((p) => p.body)).toEqual([
			expect.objectContaining({ value: FAKE_VALUE, replace: false }),
			expect.objectContaining({ value: FAKE_VALUE, replace: true })
		]);
		expect(onstored).toHaveBeenCalledWith('VERCEL_TOKEN', ['lumen']);
		valueGone();
	});

	it('cancelling the replace question closes the popup without storing', async () => {
		const fn = server([[409, { message: 'exists' }]]);
		const props = show({ ask: ASK });
		await settle();
		type(input('vault-add-value')!, FAKE_VALUE);
		submit();
		await settle();
		button('Cancel')!.click();
		flushSync();
		expect(props.open).toBe(false);
		expect(posted(fn)).toHaveLength(1);
		valueGone();
	});

	it('keeps the popup open on Escape while storing, then forgets the value', async () => {
		let answer: (r: Response) => void = () => {};
		vi.stubGlobal(
			'fetch',
			vi.fn((_url: string, init?: RequestInit) =>
				!init?.method || init.method === 'GET'
					? Promise.resolve(new Response(JSON.stringify({ canStore: true, reason: null })))
					: new Promise<Response>((r) => (answer = r))
			)
		);
		const props = show({ ask: ASK });
		await settle();
		type(input('vault-add-value')!, FAKE_VALUE);
		submit();
		await settle();
		const escape = new Event('cancel', { cancelable: true });
		document.querySelector('[data-vault-add]')!.dispatchEvent(escape);
		flushSync();
		expect(escape.defaultPrevented).toBe(true);
		expect(props.open).toBe(true);
		answer(new Response(JSON.stringify({ message: 'exists' }), { status: 409 }));
		await settle();
		expect(document.querySelector('[data-vault-exists]')).toBeTruthy();
		valueGone();
	});

	it('cancelling forgets the value, and the next opening starts empty', async () => {
		const fn = server([]);
		const props = show({ ask: ASK });
		await settle();
		type(input('vault-add-value')!, FAKE_VALUE);
		button('Cancel')!.click();
		flushSync();
		expect(props.open).toBe(false);
		valueGone();
		props.open = true;
		flushSync();
		await settle();
		expect(input('vault-add-value')!.value).toBe('');
		expect(posted(fn)).toEqual([]);
	});

	it('forgets the value when storing fails, and never shows it in the error', async () => {
		server([[502, { message: 'Could not store it: wh-vault exited 1.' }]]);
		show();
		await settle();
		type(input('vault-add-name')!, 'NPM_TOKEN');
		type(input('vault-add-value')!, FAKE_VALUE);
		submit();
		await settle();
		expect(document.querySelector('[role="alert"]')!.textContent).toMatch(/wh-vault exited 1/);
		expect(input('vault-add-value')!.value).toBe('');
		valueGone();
	});

	it('refuses a name that is not an environment variable name, sending nothing', async () => {
		const fn = server([]);
		show();
		await settle();
		type(input('vault-add-name')!, '1-bad name');
		type(input('vault-add-value')!, FAKE_VALUE);
		submit();
		await settle();
		expect(document.querySelector('[role="alert"]')!.textContent).toMatch(/letters, digits/);
		expect(posted(fn)).toEqual([]);
	});

	it('says plainly when this computer cannot store a secret, before a value is typed', async () => {
		server([], {
			canStore: false,
			reason: 'The vault keeps values in the macOS login Keychain, and this computer is not a Mac.'
		});
		show({ ask: ASK });
		await settle();
		expect(document.querySelector('[data-vault-unavailable]')!.textContent).toMatch(/not a Mac/);
		expect(input('vault-add-value')!.disabled).toBe(true);
		expect(button('Store secret')!.disabled).toBe(true);
	});
});
