import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_GATEWAY } from '$lib/cloud';
import { live } from '$lib/client/live.svelte';
import type { FleetView } from '$lib/fleet';
import type { MateLinkStatus } from '$lib/matelink';
import type { SecondMate } from '$lib/types';
import { fleetOf } from '../../../../tests/helpers/task-summary';

vi.mock('$app/state', () => ({
	page: {
		data: { sessionToken: 'test-session', features: { fleet: true } },
		url: new URL('http://127.0.0.1:4310/fleet/mates')
	}
}));

const { default: Mates } = await import('./+page.svelte');
const { default: Overview } = await import('../+page.svelte');

const status = (online: boolean): MateLinkStatus => ({
	machine: 'mate-demo',
	here: 'this Mac',
	health: online ? 'linked' : 'down',
	online,
	approved: online ? true : null,
	problem: online ? null : { code: 'stopped', text: 'mate-demo is stopped.', action: 'wake' },
	checkedAt: '2026-11-28T09:00:00Z',
	urls: { machines: null, approve: null }
});

const mate = (id: string, o: Partial<SecondMate> = {}): SecondMate => ({
	id,
	where: 'local',
	host: null,
	link: null,
	home: `/home/fm/${id}`,
	stateLabel: 'Working',
	tone: 'working',
	health: {
		online: 'online',
		text: 'Online',
		reason: null,
		observedAt: null,
		ageSeconds: 10,
		cached: false,
		host: { cpu: null, memory: null, disk: null },
		hostNote: null
	},
	projects: ['checkout-service'],
	inFlight: [],
	queued: [],
	landed: [],
	prs: [],
	previews: [],
	previewNote: null,
	decisions: 0,
	captainDecisions: 0,
	omitted: [],
	lastReport: null,
	peek: { available: true, reason: null },
	...o
});

const cloudMate = (id: string, online = true) =>
	mate(id, {
		where: 'remote',
		host: 'fy-mate-demo',
		link: { via: 'fleetyard', machine: 'mate-demo', status: status(online) }
	});

const company = (matesOn: boolean): FleetView => ({
	schema: 'wheelhouse-fleet.v1',
	state: 'joined',
	gateway: DEFAULT_GATEWAY,
	fleetyard: true,
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
		matesOn
			? {
					key: 'cloud_second_mates',
					label: 'Cloud second mates',
					on: true,
					reason: null,
					note: null,
					why: null
				}
			: {
					key: 'cloud_second_mates',
					label: 'Cloud second mates',
					on: false,
					reason: 'off_by_team',
					note: 'Switched off for Payments squad by Dev Kapoor.',
					why: 'Paused until the AWS budget review on 4 Dec.'
				}
	],
	checkedAt: new Date().toISOString(),
	error: null,
	gateways: [],
	pairing: null,
	viaRelay: false
});

/** Wheelhouse's APIs as these pages ask them; each POST is kept. */
function server() {
	const posts: { url: string; body: Record<string, unknown> }[] = [];
	vi.stubGlobal(
		'fetch',
		vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = String(input);
			if (init?.method === 'POST') {
				posts.push({ url, body: JSON.parse(String(init.body)) as Record<string, unknown> });
				return Response.json({
					status: {
						...status(false),
						problem: {
							code: 'stopping',
							text: 'mate-demo is stopping; wake it once it has stopped.',
							action: null
						}
					},
					job: null
				});
			}
			if (url.startsWith('/api/second-mate-setup'))
				return Response.json({
					gateway: DEFAULT_GATEWAY,
					cloud: { gateway: DEFAULT_GATEWAY, device: { id: 'd', gateway: DEFAULT_GATEWAY } },
					deviceError: null,
					sshKeys: [],
					vaultNames: []
				});
			if (url.includes('/link')) return Response.json({ status: status(true), job: null });
			return new Response('{}');
		})
	);
	return posts;
}

let app: ReturnType<typeof mount> | null = null;
beforeEach(() => {
	live.fleet = {
		...fleetOf([]),
		secondMates: [cloudMate('night-shift'), mate('harbourmaster')]
	};
});
afterEach(() => {
	if (app) unmount(app);
	app = null;
	live.fleet = null;
	document.body.innerHTML = '';
	vi.unstubAllGlobals();
});

const text = () => document.body.textContent ?? '';
const q = (id: string) => document.querySelector(`[data-testid="${id}"]`);

describe('Fleet → Second mates', () => {
	it('shows the cloud second mates with Stop, the rest by count, and Launch', async () => {
		server();
		app = mount(Mates, {
			target: document.body,
			props: { data: { membership: company(true), hostedSecondMates: true } } as never
		});
		flushSync();
		const cards = [...document.querySelectorAll('[data-second-mate]')];
		expect(cards.map((c) => c.getAttribute('data-second-mate'))).toEqual(['night-shift']);
		expect(cards[0].querySelector('[data-testid="mate-stop"]')).not.toBeNull();
		expect(q('fleet-mates-others')?.textContent?.replace(/\s+/g, ' ')).toContain(
			'1 more runs on this computer or your own hosts'
		);
		expect(q('fleet-mates-plan')?.textContent).toBe('Larkspur Market · Team plan');
		expect(q('fleet-switched-off')).toBeNull();
		// The Add second mate wizard, under this page's own heading rather than its own.
		expect(document.getElementById('launch')?.textContent).toContain('Launch a second mate');
		expect(q('add-second-mate')?.tagName).toBe('DIV');
		await vi.waitFor(() => expect(text()).toContain('Where should it run?'));
		expect(text()).not.toContain('Crew · Second mates');
	});

	it('stops a cloud second mate only once the captain says so', async () => {
		const posts = server();
		app = mount(Mates, {
			target: document.body,
			props: { data: { membership: company(true), hostedSecondMates: true } } as never
		});
		flushSync();
		(q('mate-stop') as HTMLButtonElement).click();
		flushSync();
		expect(posts).toEqual([]);
		expect(q('mate-stop-confirm')?.textContent).toContain(
			'Stop mate-demo? night-shift stops with it until you wake it'
		);
		(q('mate-stop-yes') as HTMLButtonElement).click();
		await vi.waitFor(() =>
			expect(q('mate-stopped')?.textContent).toBe(
				'mate-demo is stopping; wake it once it has stopped.'
			)
		);
		expect(posts).toEqual([
			{ url: '/api/second-mates/night-shift/link', body: { action: 'stop' } }
		]);
	});

	it('offers no Stop for a machine already stopped: Wake is the card’s', () => {
		server();
		live.fleet = { ...fleetOf([]), secondMates: [cloudMate('night-shift', false)] };
		app = mount(Mates, {
			target: document.body,
			props: { data: { membership: company(true), hostedSecondMates: true } } as never
		});
		flushSync();
		expect(document.querySelector('[data-second-mate="night-shift"]')).not.toBeNull();
		expect(q('mate-stop')).toBeNull();
	});

	it('says who switched cloud second mates off and why, with no Launch, and keeps Stop', () => {
		server();
		app = mount(Mates, {
			target: document.body,
			props: { data: { membership: company(false), hostedSecondMates: true } } as never
		});
		flushSync();
		const card = q('fleet-switched-off');
		expect(card?.getAttribute('data-reason')).toBe('off_by_team');
		expect(card?.textContent).toContain('Switched off for Payments squad by Dev Kapoor.');
		expect(card?.textContent).toContain('“Paused until the AWS budget review on 4 Dec.”');
		expect(document.getElementById('launch')).toBeNull();
		expect(q('add-second-mate')).toBeNull();
		expect(q('mate-stop')).not.toBeNull();
	});

	it('says what is none yet, and where Launch is turned on when Hosted second mates is off', () => {
		server();
		live.fleet = { ...fleetOf([]), secondMates: [] };
		app = mount(Mates, {
			target: document.body,
			props: { data: { membership: company(true), hostedSecondMates: false } } as never
		});
		flushSync();
		expect(q('fleet-mates-none')).not.toBeNull();
		expect(q('fleet-mates-others')).toBeNull();
		expect(q('add-second-mate')).toBeNull();
		expect(
			q('fleet-mates-launch-off')?.querySelector('a[href="/settings/experimental"]')
		).not.toBeNull();
	});
});

describe('Fleet → Overview’s Second mates card', () => {
	it('says what runs in the cloud and how much work it has', () => {
		server();
		live.fleet = {
			...fleetOf([]),
			secondMates: [
				cloudMate('night-shift'),
				{
					...cloudMate('refunds-helper'),
					inFlight: [{ id: 't1' }, { id: 't2' }] as SecondMate['inFlight']
				}
			]
		};
		app = mount(Overview, {
			target: document.body,
			props: { data: { membership: company(true), relayGateway: null, remote: null } } as never
		});
		flushSync();
		const card = q('fleet-card-mates');
		expect(card?.getAttribute('href')).toBe('/fleet/mates');
		expect(card?.textContent).toContain('2 run in the cloud: night-shift, refunds-helper.');
		expect(card?.textContent).toContain('2 tasks under way');
	});

	it('is locked with the team’s reason when cloud second mates are off', () => {
		server();
		app = mount(Overview, {
			target: document.body,
			props: { data: { membership: company(false), relayGateway: null, remote: null } } as never
		});
		flushSync();
		const card = q('fleet-card-mates');
		expect(card?.getAttribute('data-locked')).toBe('true');
		expect(card?.textContent).toContain('Paused until the AWS budget review on 4 Dec.');
		expect(card?.textContent).toContain('off_by_team');
	});
});
