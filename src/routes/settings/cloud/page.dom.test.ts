import { flushSync, mount, tick, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CloudView } from '$lib/cloud';

vi.mock('$app/state', () => ({
	page: {
		data: { sessionToken: 'session-token' },
		url: new URL('http://127.0.0.1:4310/settings/cloud')
	}
}));

const { default: Page } = await import('./+page.svelte');

const now = Date.now();
const view = (o: Partial<CloudView> = {}): CloudView => ({
	schema: 'wheelhouse-cloud.v1',
	enabled: true,
	gateway: 'https://cloud.example.com',
	device: {
		id: 'd-1',
		name: 'Studio Mac',
		user: 'Captain',
		fingerprint: 'ABCD-EFGH-IJKL-MNOP',
		pairedAt: new Date(now - 86_400_000).toISOString()
	},
	keyStore: 'the macOS Keychain (wheelhouse-cloud)',
	state: 'online',
	reason: null,
	since: new Date(now - 10 * 60_000).toISOString(),
	lastSeen: new Date(now - 5_000).toISOString(),
	sessions: [
		{
			id: '7b0c1d2e-aaaa',
			user: 'Captain',
			firstAt: new Date(now - 60_000).toISOString(),
			lastAt: new Date(now - 2_000).toISOString(),
			requests: 12
		}
	],
	viaRelay: false,
	...o
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
	[...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === text);
const show = (v: CloudView) => {
	app = mount(Page, { target: document.body, props: { data: { view: v } } as never });
	flushSync();
};

describe('Settings → Cloud', () => {
	it('shows the machine online, since when, last seen, its fingerprint and its relay sessions', () => {
		show(view());
		const text = document.body.textContent ?? '';
		expect(document.querySelector('[data-state]')?.getAttribute('data-state')).toBe('online');
		expect(text).toContain('Online');
		expect(text).toContain('since 10 min ago');
		expect(document.querySelector('[data-testid="last-seen"]')?.textContent).toContain('just now');
		expect(document.querySelector('[data-testid="fingerprint"]')?.textContent).toBe(
			'ABCD-EFGH-IJKL-MNOP'
		);
		expect(text).toContain('the macOS Keychain (wheelhouse-cloud)');
		expect(text).toContain('approved by Captain');
		expect(text).toContain('12 requests');
	});

	it('disconnects only after a second click, with the session token', async () => {
		const fetch = vi.fn(
			async () =>
				new Response(
					JSON.stringify({
						view: view({ device: null, state: 'off', enabled: false, sessions: [] }),
						note: null
					}),
					{ status: 200 }
				)
		);
		vi.stubGlobal('fetch', fetch);
		show(view());
		button('Disconnect')!.click();
		flushSync();
		expect(fetch).not.toHaveBeenCalled();
		expect(document.body.textContent).toContain('revokes this machine on the gateway');
		(document.querySelector('[data-testid="confirm-disconnect"]') as HTMLButtonElement).click();
		await settle();
		const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
		expect(url).toBe('/api/cloud');
		expect((init.headers as Record<string, string>)['x-wheelhouse-session']).toBe('session-token');
		expect(JSON.parse(init.body as string)).toEqual({ action: 'disconnect' });
		expect(document.body.textContent).toContain('Not paired');
		expect(button('Disconnect')).toBeUndefined();
	});

	it('says how to pair in a terminal, and takes a gateway while none is paired', async () => {
		const fetch = vi.fn(
			async () =>
				new Response(
					JSON.stringify({
						view: view({
							device: null,
							state: 'off',
							enabled: false,
							gateway: 'https://gw.example.org'
						}),
						note: null
					}),
					{ status: 200 }
				)
		);
		vi.stubGlobal('fetch', fetch);
		show(
			view({
				device: null,
				state: 'off',
				enabled: false,
				gateway: '',
				keyStore: null,
				sessions: []
			})
		);
		expect(document.body.textContent).toContain('wheelhouse remote connect --gateway <url>');
		expect(button('Turn on')).toBeUndefined();
		const input = document.querySelector('input[type="url"]') as HTMLInputElement;
		input.value = 'https://gw.example.org';
		input.dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
		expect(button('Save')!.disabled).toBe(false);
		document.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
		await settle();
		const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
		expect(JSON.parse(init.body as string)).toEqual({
			action: 'gateway',
			gateway: 'https://gw.example.org'
		});
	});

	it('warns a page that came through the cloud before it turns the cloud off', () => {
		show(view({ viaRelay: true }));
		expect(document.body.textContent).toContain('You are looking at this page through the cloud');
	});

	it('shows why the connector stopped', () => {
		show(
			view({
				state: 'stopped',
				reason: 'Another connection with this machine’s key replaced this one (4409).',
				since: null
			})
		);
		expect(document.body.textContent).toContain('Stopped');
		expect(document.body.textContent).toContain('replaced this one (4409)');
	});
});
