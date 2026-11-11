import { flushSync, mount, tick, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_GATEWAY, type CloudView } from '$lib/cloud';

vi.mock('$app/state', () => ({
	page: {
		data: { sessionToken: 'session-token' },
		url: new URL('http://127.0.0.1:4310/remotes')
	}
}));

const { default: Page } = await import('./+page.svelte');

const now = Date.now();
const view = (o: Partial<CloudView> = {}): CloudView => ({
	schema: 'wheelhouse-cloud.v1',
	enabled: true,
	started: true,
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
const answering = (v: CloudView) =>
	vi.fn(async () => new Response(JSON.stringify({ view: v, note: null }), { status: 200 }));
const sent = (fetch: ReturnType<typeof answering>, i = 0) => {
	const [url, init] = fetch.mock.calls[i] as unknown as [string, RequestInit];
	return {
		url,
		session: (init.headers as Record<string, string>)['x-wheelhouse-session'],
		body: JSON.parse(init.body as string) as Record<string, unknown>
	};
};
const unpaired = (o: Partial<CloudView> = {}) =>
	view({
		device: null,
		state: 'off',
		enabled: false,
		started: false,
		gateway: DEFAULT_GATEWAY,
		keyStore: null,
		since: null,
		lastSeen: null,
		sessions: [],
		...o
	});
const show = (v: CloudView) => {
	app = mount(Page, { target: document.body, props: { data: { view: v } } as never });
	flushSync();
};

describe('Remotes', () => {
	it('shows the machine online, since when, last seen, its fingerprint and its sessions', () => {
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
		expect(button('Stop')).toBeDefined();
	});

	it('is off until started: Start, with the session token, turns it on', async () => {
		const fetch = answering(view({ state: 'connecting', since: null }));
		vi.stubGlobal('fetch', fetch);
		show(view({ started: false, state: 'off', since: null }));
		expect(document.querySelector('[data-testid="remote-state"]')?.textContent).toBe('Off');
		expect(document.body.textContent).toContain(
			'nothing reaches this machine until you press Start'
		);
		button('Start')!.click();
		await settle();
		expect(sent(fetch)).toEqual({
			url: '/api/cloud',
			session: 'session-token',
			body: { action: 'start' }
		});
		expect(document.body.textContent).toContain('Connecting');
		expect(button('Stop')).toBeDefined();
	});

	it('stops it', async () => {
		const fetch = answering(view({ enabled: false, started: false, state: 'off', since: null }));
		vi.stubGlobal('fetch', fetch);
		show(view());
		button('Stop')!.click();
		await settle();
		expect(sent(fetch).body).toEqual({ action: 'stop' });
		expect(button('Start')).toBeDefined();
	});

	it('pairs first when not paired: the code, the gateway’s own page and the fingerprint, with a warning', async () => {
		const pairing = {
			gateway: DEFAULT_GATEWAY,
			verificationUri: `${DEFAULT_GATEWAY}/pair`,
			userCode: 'BCDF-GHJK',
			fingerprint: 'WXYZ-1234-ABCD-5678',
			expiresAt: new Date(now + 600_000).toISOString(),
			error: null
		};
		const fetch = answering(unpaired({ pairing }));
		vi.stubGlobal('fetch', fetch);
		show(unpaired());
		expect(document.body.textContent).toContain('Start pairs it first');
		button('Start')!.click();
		await settle();
		expect(sent(fetch).body).toEqual({ action: 'start' });
		expect(document.querySelector('[data-testid="pair-code"]')?.textContent).toBe('BCDF-GHJK');
		expect(document.querySelector('[data-testid="pair-fingerprint"]')?.textContent).toBe(
			'WXYZ-1234-ABCD-5678'
		);
		const link = document.querySelector('[data-testid="pairing"] a') as HTMLAnchorElement;
		expect(link.href).toBe(`${DEFAULT_GATEWAY}/pair`);
		expect(document.body.textContent).toContain('Whoever approves this code');
		expect(document.querySelector('[data-testid="remote-state"]')?.textContent).toBe(
			'Waiting for approval'
		);
		// While it pairs, the gateway is fixed and Stop cancels.
		expect(document.querySelector('input[type="url"]')).toBeNull();
		expect(button('Stop')).toBeDefined();
	});

	it('says why a pairing ended', () => {
		show(
			unpaired({
				pairing: {
					gateway: DEFAULT_GATEWAY,
					verificationUri: `${DEFAULT_GATEWAY}/pair`,
					userCode: '',
					fingerprint: 'WXYZ',
					expiresAt: new Date(now).toISOString(),
					error:
						'The pairing was denied on the gateway. Nothing was paired; press Start for a new code.'
				}
			})
		);
		expect(document.body.textContent).toContain('The pairing was denied on the gateway');
		expect(document.querySelector('[data-testid="pairing"]')).toBeNull();
		expect(button('Start')).toBeDefined();
	});

	it('starts from the default gateway and takes another while none is paired', async () => {
		const fetch = answering(unpaired({ gateway: 'https://gw.example.org' }));
		vi.stubGlobal('fetch', fetch);
		show(unpaired());
		const input = document.querySelector('input[type="url"]') as HTMLInputElement;
		expect(input.value).toBe(DEFAULT_GATEWAY);
		expect(document.body.textContent).toContain('The default gateway.');
		input.value = 'https://gw.example.org';
		input.dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
		expect(button('Save')!.disabled).toBe(false);
		document.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
		await settle();
		expect(sent(fetch).body).toEqual({ action: 'gateway', gateway: 'https://gw.example.org' });
		expect(document.body.textContent).toContain('Your own gateway');
	});

	it('shows a refused gateway’s reason', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(
				async () =>
					new Response(JSON.stringify({ message: 'The gateway must be an https:// URL.' }), {
						status: 400
					})
			)
		);
		show(unpaired());
		const input = document.querySelector('input[type="url"]') as HTMLInputElement;
		input.value = 'http://gw.example.org';
		input.dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
		document.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
		await settle();
		expect(document.querySelector('[role="alert"]')?.textContent).toContain('must be an https://');
	});

	it('revokes only after a second click', async () => {
		const fetch = answering(unpaired());
		vi.stubGlobal('fetch', fetch);
		show(view());
		expect(document.querySelector('input[type="url"]')).toBeNull();
		button('Revoke…')!.click();
		flushSync();
		expect(fetch).not.toHaveBeenCalled();
		expect(document.body.textContent).toContain('removes this machine on the gateway');
		(document.querySelector('[data-testid="confirm-disconnect"]') as HTMLButtonElement).click();
		await settle();
		expect(sent(fetch).body).toEqual({ action: 'disconnect' });
		expect(document.body.textContent).toContain('Not paired');
		expect(button('Revoke…')).toBeUndefined();
	});

	it('offers Start to pair again after the gateway removed a started machine', async () => {
		const fetch = answering(unpaired({ enabled: true, started: true }));
		vi.stubGlobal('fetch', fetch);
		show(
			unpaired({
				enabled: true,
				started: true,
				state: 'not-paired',
				reason: 'This machine was removed on the gateway (4403).'
			})
		);
		expect(document.querySelector('[data-testid="remote-state"]')?.textContent).toBe('Not paired');
		expect(button('Stop')).toBeUndefined();
		button('Start')!.click();
		await settle();
		expect(sent(fetch).body).toEqual({ action: 'start' });
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
