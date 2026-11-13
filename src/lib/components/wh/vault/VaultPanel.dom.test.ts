import { flushSync, mount, tick, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SlotEntry } from '$lib/plugins/types';
import type { VaultSecret } from '$lib/vault';

vi.mock('$app/state', () => ({
	page: {
		data: {
			sessionToken: 'session-token',
			fleet: { projects: [{ id: 'atlas' }, { id: 'lumen' }] }
		},
		url: new URL('http://127.0.0.1:4310/plugins/vault/overview')
	}
}));

const { default: VaultPanel } = await import('./VaultPanel.svelte');

/** Plainly fake, and never token-shaped. */
const FAKE_VALUE = 'not-a-real-value';

const secret = (o: Partial<VaultSecret> = {}): VaultSecret => ({
	name: 'DEPLOY_TOKEN',
	projects: ['atlas'],
	updatedAt: '2026-10-28T09:30:00.000Z',
	lastUsedAt: null,
	...o
});
const entry = (secrets: VaultSecret[]): { data: unknown; entry: SlotEntry } => {
	const value = { secrets, used: [], problem: null };
	return {
		data: value,
		entry: {
			key: 'vault/overview',
			slot: 'nav.page',
			pluginId: 'vault',
			contributionId: 'overview',
			title: 'Vault',
			order: 500,
			step: null,
			projectId: null,
			render: { component: 'vault/overview' },
			badge: null,
			content: { available: true, value, source: 's', observedAt: '2026-10-30T10:00:00.000Z' }
		}
	};
};

let app: ReturnType<typeof mount> | null = null;
afterEach(() => {
	if (app) unmount(app);
	app = null;
	document.body.innerHTML = '';
	vi.unstubAllGlobals();
	storeStatus = { canStore: true, reason: null, where: 'your Mac’s login Keychain' };
});

const settle = async () => {
	for (let i = 0; i < 5; i++) {
		await new Promise((r) => setTimeout(r, 0));
		await tick();
	}
	flushSync();
};
const button = (text: string) =>
	[...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)!;
const input = (id: string) => document.getElementById(id) as HTMLInputElement;
const type = (el: HTMLInputElement, v: string) => {
	el.value = v;
	el.dispatchEvent(new Event('input', { bubbles: true }));
	flushSync();
};
const box = (label: string) =>
	[...document.querySelectorAll('label')]
		.find((l) => l.textContent?.trim() === label)!
		.querySelector('input') as HTMLInputElement;
/**
 * Stub fetch with `changes` for the page's POSTs; its own GET /api/vault, which
 * asks whether a value can be stored here, answers `status` and is not counted.
 */
let storeStatus: object = { canStore: true, reason: null, where: 'your Mac’s login Keychain' };
const stubFetch = (changes: (...a: unknown[]) => unknown) =>
	vi.stubGlobal('fetch', (url: string, init?: RequestInit) =>
		url === '/api/vault' && !init
			? Promise.resolve(new Response(JSON.stringify(storeStatus)))
			: changes(url, init)
	);
const answer = (status: number, body: object) =>
	vi.fn(async () => new Response(JSON.stringify(body), { status }));

describe('the Vault page', () => {
	it('says plainly when this computer cannot store a value, and offers no way to add one', async () => {
		storeStatus = {
			canStore: false,
			reason:
				'This computer cannot store a secret now: secret-tool is not installed; opt in with `wh-vault backend env-file`.',
			where: 'the login keyring (Secret Service)'
		};
		stubFetch(vi.fn());
		app = mount(VaultPanel, { target: document.body, props: entry([secret()]) });
		await settle();
		const alert = document.querySelector('[data-vault-unavailable]');
		expect(alert?.textContent).toContain('secret-tool is not installed');
		expect(alert?.textContent).toContain('wh-vault backend env-file');
		expect(document.body.textContent).toContain(
			'Values stay in the login keyring (Secret Service)'
		);
		expect(button('Add a secret').disabled).toBe(true);
	});

	it('offers to add a first secret when the vault is empty', () => {
		app = mount(VaultPanel, { target: document.body, props: entry([]) });
		flushSync();
		expect(document.body.textContent).toContain('The vault is empty');
		button('Add a secret').click();
		flushSync();
		expect(input('vault-name')).toBeTruthy();
		expect(input('vault-value').type).toBe('password');
	});

	it('sends a new secret once, with the session token, then forgets the value', async () => {
		const fetch = answer(200, {
			message: 'Stored DEPLOY_TOKEN in your Mac’s login Keychain. lumen can use it.',
			secrets: [secret({ projects: ['lumen'] })],
			observedAt: '2026-10-30T12:00:00.000Z'
		});
		stubFetch(fetch);
		app = mount(VaultPanel, { target: document.body, props: entry([]) });
		flushSync();
		button('Add a secret').click();
		flushSync();
		type(input('vault-name'), 'DEPLOY_TOKEN');
		type(input('vault-value'), FAKE_VALUE);
		box('lumen').click();
		flushSync();
		button('Store secret').click();
		await settle();

		expect(fetch).toHaveBeenCalledTimes(1);
		const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
		expect(url).toBe('/api/vault');
		expect(init.method).toBe('POST');
		expect((init.headers as Record<string, string>)['x-wheelhouse-session']).toBe('session-token');
		expect(JSON.parse(init.body as string)).toEqual({
			action: 'set',
			name: 'DEPLOY_TOKEN',
			value: FAKE_VALUE,
			projects: ['lumen']
		});
		expect(document.querySelector('[role="status"]')?.textContent).toContain('Stored DEPLOY_TOKEN');
		// The form is gone and nothing on the page holds the value.
		expect(input('vault-value')).toBeNull();
		expect(document.body.innerHTML).not.toContain(FAKE_VALUE);
		expect(document.body.textContent).toContain('DEPLOY_TOKEN');
	});

	it('refuses a name that is not an environment variable name, without sending', () => {
		const fetch = vi.fn();
		stubFetch(fetch);
		app = mount(VaultPanel, { target: document.body, props: entry([]) });
		flushSync();
		button('Add a secret').click();
		flushSync();
		type(input('vault-name'), '1-bad');
		type(input('vault-value'), FAKE_VALUE);
		button('Store secret').click();
		flushSync();
		expect(document.querySelector('[role="alert"]')?.textContent).toMatch(/letters, digits/);
		expect(fetch).not.toHaveBeenCalled();
	});

	it('grants and revokes from a secret’s row, and puts a box back when the change fails', async () => {
		const fetch = answer(200, {
			message: 'lumen can now use DEPLOY_TOKEN.',
			secrets: [secret({ projects: ['atlas', 'lumen'] })],
			observedAt: '2026-10-30T12:00:00.000Z'
		});
		stubFetch(fetch);
		app = mount(VaultPanel, { target: document.body, props: entry([secret()]) });
		flushSync();
		expect(button('Add a secret')).toBeTruthy();
		document.querySelector<HTMLButtonElement>('[aria-controls="vault-DEPLOY_TOKEN"]')!.click();
		flushSync();
		expect(box('atlas').checked).toBe(true);
		box('lumen').click();
		await settle();
		expect(
			JSON.parse((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)
		).toEqual({
			action: 'grant',
			name: 'DEPLOY_TOKEN',
			projects: ['lumen']
		});
		expect(box('lumen').checked).toBe(true);

		stubFetch(answer(502, { message: 'Could not revoke it: the vault file is busy.' }));
		box('atlas').click();
		await settle();
		expect(document.querySelector('[role="alert"]')?.textContent).toContain('Could not revoke it');
		expect(box('atlas').checked).toBe(true);
	});

	it('asks before removing a secret', async () => {
		const fetch = answer(200, {
			message: 'Removed DEPLOY_TOKEN.',
			secrets: [],
			observedAt: '2026-10-30T12:00:00.000Z'
		});
		stubFetch(fetch);
		app = mount(VaultPanel, { target: document.body, props: entry([secret()]) });
		flushSync();
		document.querySelector<HTMLButtonElement>('[aria-controls="vault-DEPLOY_TOKEN"]')!.click();
		flushSync();
		button('Remove…').click();
		flushSync();
		expect(fetch).not.toHaveBeenCalled();
		expect(document.body.textContent).toContain('This cannot be undone.');
		button('Remove').click();
		await settle();
		expect(
			JSON.parse((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)
		).toEqual({
			action: 'remove',
			name: 'DEPLOY_TOKEN'
		});
		expect(document.body.textContent).toContain('The vault is empty');
	});
});
