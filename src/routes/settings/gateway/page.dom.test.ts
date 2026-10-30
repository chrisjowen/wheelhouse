import { flushSync, mount, tick, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GatewayChannelView, GatewayView } from '$lib/gateway';

vi.mock('$app/state', () => ({
	page: {
		data: { sessionToken: 'session-token' },
		url: new URL('http://127.0.0.1:4310/settings/gateway')
	}
}));

const { default: Page } = await import('./+page.svelte');

const channel = (o: Partial<GatewayChannelView> = {}): GatewayChannelView => ({
	channel: 'discord',
	label: 'Discord',
	token: true,
	tokenStore: 'the macOS Keychain (wheelhouse-gateway)',
	enabled: true,
	state: 'connected',
	reason: null,
	bot: { id: '999', name: 'wheelhouse-bot' },
	paired: null,
	pairing: null,
	pairingNote: null,
	alerts: ['question', 'pr-green', 'stuck'],
	titlesOnly: false,
	...o
});
const view = (c: GatewayChannelView): GatewayView => ({
	schema: 'wheelhouse-gateway.v1',
	available: true,
	reason: null,
	settingsDir: '/home/captain/.config/wheelhouse/gateway',
	channels: [c]
});

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
const button = (text: string) =>
	[...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)!;

describe('Settings → Gateway', () => {
	it('shows the pairing code only to the page that asked, with the session token sent', async () => {
		const expiresAt = '2026-10-29T10:10:00Z';
		const fetch = vi.fn(
			async () =>
				new Response(
					JSON.stringify({
						view: view(channel({ pairing: { expiresAt } })),
						pairing: { code: 'ABCD-EFGH', expiresAt }
					}),
					{ status: 200 }
				)
		);
		vi.stubGlobal('fetch', fetch);
		app = mount(Page, {
			target: document.body,
			props: { data: { view: view(channel()) } } as never
		});
		flushSync();
		expect(document.body.textContent).toContain('Connected');
		expect(document.body.textContent).toContain('as wheelhouse-bot');
		expect(document.body.textContent).toContain('Not paired: no one’s messages reach Firstmate.');

		button('Pair an account').click();
		await settle();
		const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
		expect(url).toBe('/api/gateway');
		expect((init.headers as Record<string, string>)['x-wheelhouse-session']).toBe('session-token');
		expect(JSON.parse(init.body as string)).toEqual({ channel: 'discord', action: 'pair' });
		expect(document.querySelector('[data-testid="pairing-code"]')?.textContent?.trim()).toBe(
			'ABCD-EFGH'
		);
		expect(button('Cancel pairing')).toBeTruthy();
	});

	it('offers pairing only once connected, and says where the token is set', () => {
		app = mount(Page, {
			target: document.body,
			props: {
				data: { view: view(channel({ token: false, state: 'no-token', bot: null })) }
			} as never
		});
		flushSync();
		expect(document.body.textContent).toContain('No bot token');
		expect(document.body.textContent).toContain('wheelhouse gateway connect discord');
		expect(button('Pair an account').disabled).toBe(true);
		// No token: nothing to turn on or off yet.
		expect(button('Turn off')).toBeUndefined();
	});

	it('says where the token is kept, and switches titles only', async () => {
		const fetch = vi.fn(
			async () =>
				new Response(JSON.stringify({ view: view(channel({ titlesOnly: true })), pairing: null }), {
					status: 200
				})
		);
		vi.stubGlobal('fetch', fetch);
		app = mount(Page, {
			target: document.body,
			props: { data: { view: view(channel()) } } as never
		});
		flushSync();
		expect(document.body.textContent).toContain('the macOS Keychain (wheelhouse-gateway)');
		const box = [...document.querySelectorAll('label')]
			.find((l) => l.textContent?.trim().startsWith('Titles only'))!
			.querySelector('input')!;
		expect(box.checked).toBe(false);
		box.click();
		await settle();
		const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
		expect(JSON.parse(init.body as string)).toEqual({
			channel: 'discord',
			action: 'titles-only',
			titlesOnly: true
		});
		expect(box.checked).toBe(true);
	});

	it('shows why the gateway is unavailable', () => {
		app = mount(Page, {
			target: document.body,
			props: {
				data: {
					view: {
						...view(channel()),
						available: false,
						reason: 'Messaging is not set up.',
						channels: []
					}
				}
			} as never
		});
		flushSync();
		expect(document.body.textContent).toContain('Messaging is not set up.');
	});
});
