import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_GATEWAY } from '$lib/cloud';
import type { CloudView } from '$lib/cloud';

vi.mock('$app/state', () => ({
	page: {
		data: { sessionToken: 'test-session', features: { events: false, remotes: true } },
		url: new URL('http://127.0.0.1:4310/settings/gateway')
	}
}));

const { default: Page } = await import('./+page.svelte');

const view: CloudView = {
	schema: 'wheelhouse-cloud.v1',
	profileName: 'Fleetyard',
	enabled: false,
	started: false,
	gateway: DEFAULT_GATEWAY,
	device: null,
	keyStore: null,
	state: 'off',
	reason: null,
	since: null,
	lastSeen: null,
	sessions: [],
	viaRelay: false
};

let app: ReturnType<typeof mount> | null = null;
afterEach(() => {
	if (app) unmount(app);
	app = null;
	document.body.innerHTML = '';
	vi.unstubAllGlobals();
});

function mountPage(initial: CloudView = view) {
	app = mount(Page, { target: document.body, props: { data: { view: initial } } as never });
	flushSync();
}

describe('Settings → Gateway', () => {
	it('shows the shared profile, the default Gateway, and feature usage', () => {
		vi.stubGlobal('fetch', vi.fn());
		mountPage();

		expect(document.querySelector('h1')?.textContent).toBe('Gateway');
		expect(document.body.textContent).toContain(
			'remote access, second mates and future event delivery'
		);
		expect(document.querySelector<HTMLInputElement>('[aria-label="Gateway URL"]')?.value).toBe(
			DEFAULT_GATEWAY
		);
		expect(
			document.querySelector<HTMLInputElement>('[aria-label="Gateway profile name"]')?.value
		).toBe('Fleetyard');
		expect(document.body.textContent).toContain('Remote access');
		expect(document.body.textContent).toContain('Second mates');
		expect(document.body.textContent).toContain('Events');
		expect(document.querySelector('a[aria-current="page"]')?.textContent).toContain('Gateway');
	});

	it('connects by saving the profile then starting passkey pairing with visible progress', async () => {
		const pairing = {
			gateway: 'http://127.0.0.1:4311',
			verificationUri: 'http://127.0.0.1:4311/pair',
			userCode: 'ABCD-EFGH',
			fingerprint: 'ABCD-EFGH-IJKL-MNOP',
			expiresAt: new Date(Date.now() + 60_000).toISOString(),
			error: null
		};
		const calls: Record<string, unknown>[] = [];
		vi.stubGlobal(
			'fetch',
			vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
				if (init?.method === 'POST') {
					const body = JSON.parse(String(init.body)) as Record<string, unknown>;
					calls.push(body);
					const next = body.action === 'start' ? { ...view, pairing } : view;
					return new Response(JSON.stringify({ view: next, note: null }), { status: 200 });
				}
				return new Response(JSON.stringify(view), { status: 200 });
			})
		);
		mountPage();

		document.querySelector<HTMLButtonElement>('[data-testid="gateway-connect"]')?.click();
		await vi.waitFor(() => expect(calls.map((call) => call.action)).toEqual(['profile', 'start']));
		flushSync();

		expect(calls[0]).toMatchObject({ profileName: 'Fleetyard', gateway: DEFAULT_GATEWAY });
		expect(document.querySelector('#gateway-pairing-title')?.textContent).toContain(
			'Approve this pairing with your passkey'
		);
		expect(document.body.textContent).toContain('ABCD-EFGH');
		expect(document.body.textContent).toContain('Choose fingerprint');
	});

	it('says why an unpaired machine cannot connect, such as its device key going missing', () => {
		vi.stubGlobal('fetch', vi.fn());
		mountPage({
			...view,
			enabled: true,
			state: 'not-paired',
			reason: 'This machine’s device key is missing, so it cannot connect. Pair it again.'
		});

		expect(document.querySelector('[role="alert"]')?.textContent).toContain(
			'device key is missing'
		);
	});

	it('shows a clear failure when the Gateway refuses the profile change', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(
				async () =>
					new Response(
						JSON.stringify({ message: 'Revoke this machine before changing its gateway.' }),
						{
							status: 409
						}
					)
			)
		);
		mountPage();

		document.querySelector<HTMLButtonElement>('[data-testid="gateway-connect"]')?.click();
		await vi.waitFor(() =>
			expect(document.querySelector('[role="alert"]')?.textContent).toContain('Revoke this machine')
		);
	});
});
