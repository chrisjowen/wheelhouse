import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_GATEWAY, type CloudView } from '$lib/cloud';
import type { FleetView } from '$lib/fleet';

vi.mock('$app/state', () => ({
	page: {
		data: { sessionToken: 'test-session', features: { remotes: true, fleet: true } },
		url: new URL('http://127.0.0.1:4310/fleet')
	}
}));

const { default: Overview } = await import('./+page.svelte');
const { default: Remotes } = await import('./remotes/+page.svelte');

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
	gateways: [
		{ id: 'default', name: 'Fleetyard', gateway: DEFAULT_GATEWAY, active: true, paired: false }
	],
	pairing: null,
	viaRelay: false
};

const company = (remotesOn: boolean): FleetView => ({
	...notJoined,
	state: 'joined',
	ship: { name: 'priya-mbp', fingerprint: 'ABCD-EFGH-IJKL-MNOP', pairedAt: '' },
	fleet: {
		name: 'Larkspur Market',
		slug: 'larkspur',
		kind: 'company',
		plan: 'Team',
		role: 'member',
		person: 'Priya Nair',
		teams: [{ slug: 'payments', name: 'Payments squad', role: 'member' }]
	},
	features: [
		remotesOn
			? {
					key: 'remotes',
					label: 'Reach this ship from anywhere',
					on: true,
					reason: null,
					note: null,
					why: null
				}
			: {
					key: 'remotes',
					label: 'Reach this ship from anywhere',
					on: false,
					reason: 'off_by_org',
					note: 'Switched off for Larkspur Market by Tom Okafor.',
					why: 'Only from the office network until the audit.'
				},
		{
			key: 'fleet_chat',
			label: 'Fleet chat',
			on: false,
			reason: 'off_by_org',
			note: 'Switched off for Larkspur Market by Tom Okafor.',
			why: 'We use Slack for team chat for now.'
		},
		{ key: 'sso', label: 'Single sign-on', on: false, reason: 'not_in_plan', note: '', why: null }
	],
	checkedAt: new Date().toISOString()
});

const cloud = (o: Partial<CloudView> = {}): CloudView => ({
	schema: 'wheelhouse-cloud.v1',
	enabled: false,
	started: false,
	gateway: DEFAULT_GATEWAY,
	device: null,
	keyStore: null,
	state: 'not-paired',
	reason: null,
	since: null,
	lastSeen: null,
	sessions: [],
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

const text = () => document.body.textContent ?? '';
const q = (id: string) => document.querySelector(`[data-testid="${id}"]`);

describe('Fleet → Overview', () => {
	it('shows a ship not in a fleet one way to join, through the gateway in use', async () => {
		const calls: Record<string, unknown>[] = [];
		vi.stubGlobal(
			'fetch',
			vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
				calls.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
				return new Response(
					JSON.stringify({
						view: {
							...notJoined,
							pairing: {
								gateway: DEFAULT_GATEWAY,
								verificationUri: `${DEFAULT_GATEWAY}/pair`,
								userCode: 'WHK-4F7Q',
								fingerprint: 'ABCD-EFGH-IJKL-MNOP',
								expiresAt: new Date(Date.now() + 60_000).toISOString(),
								error: null
							}
						}
					})
				);
			})
		);
		app = mount(Overview, {
			target: document.body,
			props: { data: { membership: notJoined, relayGateway: null, remote: cloud() } } as never
		});
		flushSync();
		expect(document.querySelector('h1')?.textContent).toBe('Beyond this computer');
		expect(q('fleet-through')?.textContent).toContain('Fleetyard');
		expect(q('fleet-features')).toBeNull();
		(q('fleet-join') as HTMLButtonElement).click();
		await vi.waitFor(() => expect(q('fleet-pairing')?.textContent).toContain('WHK-4F7Q'));
		expect(calls).toEqual([{ action: 'join' }]);
	});

	it('shows a company fleet, what this ship may use, and what the org switched off and why', () => {
		vi.stubGlobal('fetch', vi.fn());
		app = mount(Overview, {
			target: document.body,
			props: {
				data: {
					membership: company(true),
					relayGateway: null,
					remote: cloud({ enabled: true, started: true, state: 'online', device: {} as never })
				}
			} as never
		});
		flushSync();
		expect(q('fleet-title')?.textContent?.replace(/\s+/g, ' ').trim()).toBe(
			'Larkspur Market fleet'
		);
		expect(q('fleet-name')?.textContent).toContain('Company fleet');
		expect(text()).toContain('Payments squad');
		expect(q('fleet-card-remotes')?.textContent).toContain('On. This ship is reachable');
		const features = q('fleet-features')?.textContent ?? '';
		expect(features).toContain('Reach this ship from anywhere');
		expect(features).toContain('We use Slack for team chat for now.');
		expect(q('fleet-not-in-plan')?.textContent).toContain('Single sign-on');
		// Gateways and Leave stay in Settings → Fleet.
		expect(q('fleet-leave')).toBeNull();
		expect(document.querySelector('a[href="/settings/fleet"]')).not.toBeNull();
	});

	it('marks the Remotes card locked with the org’s reason when remote access is switched off', () => {
		vi.stubGlobal('fetch', vi.fn());
		app = mount(Overview, {
			target: document.body,
			props: { data: { membership: company(false), relayGateway: null, remote: cloud() } } as never
		});
		flushSync();
		const card = q('fleet-card-remotes');
		expect(card?.getAttribute('data-locked')).toBe('true');
		expect(card?.textContent).toContain('Only from the office network until the audit.');
		expect(card?.textContent).toContain('off_by_org');
	});
});

describe('Fleet → Remotes', () => {
	it('is the Remotes page while the fleet allows it', () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response('{}'))
		);
		app = mount(Remotes, {
			target: document.body,
			props: {
				data: { membership: company(true), relayGateway: null, view: cloud(), gateway: null }
			} as never
		});
		flushSync();
		expect(q('fleet-switched-off')).toBeNull();
		expect(text()).toContain('Remote access is off until you start it here.');
	});

	it('says who switched it off and why, with the reason code and a way to ask', () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response('{}'))
		);
		app = mount(Remotes, {
			target: document.body,
			props: {
				data: { membership: company(false), relayGateway: null, view: cloud(), gateway: null }
			} as never
		});
		flushSync();
		const card = q('fleet-switched-off');
		expect(card?.getAttribute('data-reason')).toBe('off_by_org');
		expect(card?.querySelector('h2')?.textContent).toBe('Switched off');
		expect(card?.textContent).toContain('Switched off for Larkspur Market by Tom Okafor.');
		expect(card?.textContent).toContain('“Only from the office network until the audit.”');
		const ask = new URL((q('fleet-ask') as HTMLAnchorElement).href, 'http://127.0.0.1:4310');
		expect(ask.pathname).toBe('/');
		expect(ask.searchParams.get('draft')).toContain('Reach this ship from anywhere');
		expect(text()).not.toContain('Remote access is off until you start it here.');
	});
});
