import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_GATEWAY } from '$lib/cloud';
import type { FleetView } from '$lib/fleet';

vi.mock('$app/state', () => ({
	page: {
		data: { sessionToken: 'test-session', features: { events: false, remotes: false } },
		url: new URL('http://127.0.0.1:4310/settings/fleet')
	}
}));

const { default: Page } = await import('./+page.svelte');

const notJoined: FleetView = {
	schema: 'wheelhouse-fleet.v1',
	state: 'not-joined',
	gateway: DEFAULT_GATEWAY,
	fleetyard: true,
	ship: null,
	fleet: null,
	features: [],
	checkedAt: null,
	error: null,
	pairing: null,
	viaRelay: false
};

const joined: FleetView = {
	...notJoined,
	state: 'joined',
	ship: { name: 'priya-mbp', fingerprint: 'ABCD-EFGH-IJKL-MNOP', pairedAt: '' },
	fleet: {
		name: 'Larkspur Market',
		slug: 'larkspur',
		kind: 'company',
		plan: 'team',
		role: 'member',
		person: 'Priya',
		teams: [{ slug: 'payments', name: 'Payments squad', role: 'member' }]
	},
	features: [
		{
			key: 'remotes',
			label: 'Reach this ship from anywhere',
			on: true,
			reason: null,
			note: null,
			why: null
		},
		{
			key: 'cloud_second_mates',
			label: 'Cloud second mates',
			on: false,
			reason: 'off_by_org',
			note: 'Switched off for Larkspur Market by Dev Kapoor.',
			why: 'Larkspur uses machines in its own AWS account.'
		},
		{ key: 'sso', label: 'Single sign-on', on: false, reason: 'not_in_plan', note: '', why: null }
	],
	checkedAt: new Date().toISOString()
};

let app: ReturnType<typeof mount> | null = null;
afterEach(() => {
	if (app) unmount(app);
	app = null;
	document.body.innerHTML = '';
	vi.unstubAllGlobals();
});

function mountPage(view: FleetView) {
	app = mount(Page, { target: document.body, props: { data: { view } } as never });
	flushSync();
}

describe('Settings → Fleet', () => {
	it('invites a ship not in a fleet to join, through Fleetyard by default', () => {
		vi.stubGlobal('fetch', vi.fn());
		mountPage(notJoined);
		expect(document.querySelector('h1')?.textContent).toBe('Fleet');
		expect(document.querySelector('a[aria-current="page"]')?.textContent).toBe('Fleet');
		expect(document.querySelector('[data-testid="fleet-state"]')?.textContent).toBe(
			'Not in a fleet'
		);
		expect(document.querySelector<HTMLSelectElement>('#fleet-gateway')?.value).toBe('fleetyard');
		expect(document.querySelector('[data-testid="fleet-join"]')).not.toBeNull();
		expect(document.querySelector('[data-testid="fleet-leave"]')).toBeNull();
		expect(document.querySelector('[data-testid="fleet-features"]')).toBeNull();
	});

	it('joins, then shows the code and fingerprint to approve on the gateway', async () => {
		const pairing = {
			gateway: DEFAULT_GATEWAY,
			verificationUri: `${DEFAULT_GATEWAY}/pair`,
			userCode: 'ABCD-EFGH',
			fingerprint: 'ABCD-EFGH-IJKL-MNOP',
			expiresAt: new Date(Date.now() + 60_000).toISOString(),
			error: null
		};
		const calls: Record<string, unknown>[] = [];
		vi.stubGlobal(
			'fetch',
			vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
				calls.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
				return new Response(JSON.stringify({ view: { ...notJoined, pairing }, note: null }));
			})
		);
		mountPage(notJoined);
		document.querySelector<HTMLButtonElement>('[data-testid="fleet-join"]')?.click();
		await vi.waitFor(() =>
			expect(document.querySelector('[data-testid="fleet-pairing"]')).not.toBeNull()
		);
		expect(calls).toEqual([{ action: 'join', gateway: '' }]);
		const box = document.querySelector('[data-testid="fleet-pairing"]')?.textContent ?? '';
		expect(box).toContain('ABCD-EFGH');
		expect(box).toContain('ABCD-EFGH-IJKL-MNOP');
	});

	it('asks for an address before joining your own gateway', () => {
		const fetch = vi.fn();
		vi.stubGlobal('fetch', fetch);
		mountPage(notJoined);
		const select = document.querySelector<HTMLSelectElement>('#fleet-gateway')!;
		select.value = 'custom';
		select.dispatchEvent(new Event('change', { bubbles: true }));
		flushSync();
		document.querySelector<HTMLButtonElement>('[data-testid="fleet-join"]')?.click();
		flushSync();
		expect(fetch).not.toHaveBeenCalled();
		expect(document.querySelector('[role="alert"]')?.textContent).toContain('gateway’s address');
	});

	it('shows the fleet, the role, and what this ship may use, with why others are off', () => {
		vi.stubGlobal('fetch', vi.fn());
		mountPage(joined);
		const text = document.body.textContent ?? '';
		expect(document.querySelector('#fleet-title')?.textContent?.trim()).toBe('Larkspur Market');
		expect(text).toContain('company fleet');
		expect(text).toContain('team plan');
		expect(text).toContain('Member');
		expect(text).toContain('Payments squad');
		const features = document.querySelector('[data-testid="fleet-features"]')!.textContent!;
		expect(features).toContain('Reach this ship from anywhere');
		expect(features).toContain('Switched off for Larkspur Market by Dev Kapoor.');
		expect(features).toContain('Larkspur uses machines in its own AWS account.');
		expect(document.querySelector('[data-testid="fleet-not-in-plan"]')?.textContent).toContain(
			'Single sign-on'
		);
	});

	it('leaves only after a confirmation', async () => {
		const calls: Record<string, unknown>[] = [];
		vi.stubGlobal(
			'fetch',
			vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
				calls.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
				return new Response(JSON.stringify({ view: notJoined, note: null }));
			})
		);
		mountPage(joined);
		document.querySelector<HTMLButtonElement>('[data-testid="fleet-leave"]')?.click();
		flushSync();
		expect(calls).toEqual([]);
		document.querySelector<HTMLButtonElement>('[data-testid="fleet-leave-confirm"]')?.click();
		await vi.waitFor(() =>
			expect(document.querySelector('[data-testid="fleet-state"]')?.textContent).toBe(
				'Not in a fleet'
			)
		);
		expect(calls).toEqual([{ action: 'leave' }]);
	});

	it('says plainly when the gateway has no fleets', () => {
		vi.stubGlobal('fetch', vi.fn());
		mountPage({
			...notJoined,
			state: 'no-fleets',
			ship: joined.ship,
			checkedAt: new Date().toISOString()
		});
		expect(document.querySelector('[data-testid="fleet-no-fleets"]')).not.toBeNull();
		expect(document.querySelector('[data-testid="fleet-leave"]')).not.toBeNull();
	});
});
