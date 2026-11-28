import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MatePeek, SecondMate } from '$lib/types';
import SecondMateCard from './SecondMateCard.svelte';

vi.mock('$app/state', () => ({ page: { data: { sessionToken: 'tok' } } }));

const mate: SecondMate = {
	id: 'tokyo',
	where: 'remote',
	host: 'tokyo-box',
	link: null,
	home: '/home/fm/tokyo',
	stateLabel: 'Needs your decision',
	tone: 'captain',
	health: {
		online: 'unknown',
		text: 'Not refreshed: this is what it reported 12 min ago',
		reason: 'Firstmate’s last fleet read could not fetch its summary from tokyo-box in time.',
		observedAt: null,
		ageSeconds: 720,
		cached: true,
		host: { cpu: null, memory: null, disk: null },
		hostNote: 'Host CPU, memory and disk: not reported yet.'
	},
	projects: ['lumen'],
	inFlight: [
		{
			id: 'tk-1',
			title: 'Add the share API',
			projectId: 'lumen',
			status: 'working',
			statusLabel: 'Working',
			doing: 'Review running',
			since: null,
			completedOn: null,
			pr: null,
			report: null
		}
	],
	queued: [],
	landed: [],
	prs: [
		{
			taskId: 'tk-0',
			title: 'Old work',
			url: 'https://github.com/o/lumen/pull/7',
			number: 7,
			landed: true
		}
	],
	previews: [],
	previewNote: 'Previews: not carried yet.',
	decisions: 2,
	captainDecisions: 1,
	omitted: ['3 more queued'],
	lastReport: null,
	peek: { available: true, reason: null }
};

let app: ReturnType<typeof mount> | null = null;
afterEach(() => {
	if (app) unmount(app);
	app = null;
	document.body.innerHTML = '';
	vi.unstubAllGlobals();
});

describe('a second mate on the Second mates page', () => {
	it('shows its health, work and PRs, says what is not available, and peeks only when asked', async () => {
		const peek: MatePeek = {
			available: false,
			offline: true,
			reason: 'Offline: Firstmate could not reach tokyo-box.',
			lines: [],
			capturedAt: null,
			requested: 40
		};
		const fetch = vi.fn(async () => new Response(JSON.stringify(peek)));
		vi.stubGlobal('fetch', fetch);
		app = mount(SecondMateCard, { target: document.body, props: { mate, now: Date.now() } });
		flushSync();
		const text = document.body.textContent!;
		expect(text).toContain('Last report');
		expect(text).toContain('Not refreshed: this is what it reported 12 min ago');
		expect(text).toContain('Host CPU, memory and disk: not reported yet.');
		expect(text).toContain('Add the share API');
		expect(text).toContain('2 open questions, 1 waiting on you, in Decisions');
		expect(text).toContain('#7');
		expect(text).toContain('Previews: not carried yet.');
		expect(text).toContain('leaves out 3 more queued');
		expect(fetch).not.toHaveBeenCalled();

		const look = [...document.querySelectorAll('button')].find((b) =>
			b.textContent!.includes('Look at its terminal')
		)!;
		look.click();
		await vi.waitFor(() =>
			expect(document.body.textContent).toContain('could not reach tokyo-box.')
		);
		expect(fetch).toHaveBeenCalledWith('/api/second-mates/tokyo/peek?lines=40');
	});

	it('shows a Fleetyard second mate’s link: the path, why it is down, the fix and a test', async () => {
		const stopped = {
			machine: 'mate-demo',
			here: 'this Mac',
			health: 'down',
			online: false,
			approved: null,
			problem: { code: 'stopped', text: 'mate-demo is stopped.', action: 'wake' },
			checkedAt: '2026-11-15T13:00:00Z',
			urls: { machines: 'https://fleetyard.io/machines', approve: 'https://fleetyard.io/account' }
		};
		const linked = { ...stopped, health: 'linked', online: true, approved: true, problem: null };
		const test = {
			steps: [
				{ key: 'fleetyard', label: 'Fleetyard answers', state: 'ok', ms: 84, problem: null },
				{ key: 'machine', label: 'mate-demo is online', state: 'ok', ms: null, problem: null },
				{
					key: 'approved',
					label: 'This Mac is approved on mate-demo',
					state: 'ok',
					ms: null,
					problem: null
				},
				{ key: 'mate', label: 'fleetyard-demo-mate answers', state: 'ok', ms: 412, problem: null }
			],
			status: linked,
			roundTripMs: 412,
			at: new Date().toISOString()
		};
		const fetch = vi.fn(async (url: string, init?: RequestInit) => {
			const action = init?.body ? JSON.parse(String(init.body)).action : null;
			return new Response(
				JSON.stringify(
					action === 'test'
						? test
						: {
								status:
									action === 'wake'
										? {
												...stopped,
												problem: {
													code: 'starting',
													text: 'mate-demo is starting; try again in a minute.',
													action: null
												}
											}
										: stopped,
								job: null
							}
				)
			);
		});
		vi.stubGlobal('fetch', fetch);
		const fy: SecondMate = {
			...mate,
			id: 'fleetyard-demo-mate',
			host: 'fy-mate-demo',
			tone: 'trouble',
			link: { via: 'fleetyard', machine: 'mate-demo', status: stopped as never }
		};
		app = mount(SecondMateCard, { target: document.body, props: { mate: fy, now: Date.now() } });
		flushSync();
		const text = () => document.body.textContent!.replace(/\s+/g, ' ');
		expect(text()).toContain('Remote, via Fleetyard · mate-demo');
		expect(text()).toContain('Can’t reach');
		expect(text()).toContain('mate-demo is stopped. So fleetyard-demo-mate can’t work.');
		expect(text()).toContain(
			'mate-demo, a Fleetyard machine. Its own Firstmate there is separate.'
		);
		expect(text()).toContain('This Mac');
		expect(text()).toContain('Stopped');
		expect(text()).not.toMatch(/ssh|fy-mate-demo/i);
		await vi.waitFor(() =>
			expect(fetch).toHaveBeenCalledWith(
				'/api/second-mates/fleetyard-demo-mate/link',
				expect.anything()
			)
		);

		document.querySelector<HTMLButtonElement>('[data-link-action="wake"]')!.click();
		await vi.waitFor(() => expect(text()).toContain('mate-demo is starting'));
		expect(fetch).toHaveBeenCalledWith('/api/second-mates/fleetyard-demo-mate/link', {
			method: 'POST',
			body: JSON.stringify({ action: 'wake' }),
			headers: { 'content-type': 'application/json', 'x-wheelhouse-session': 'tok' }
		});

		document.querySelector<HTMLButtonElement>('[data-link-test]')!.click();
		await vi.waitFor(() => expect(text()).toContain('Round trip 412 ms'));
		expect(
			[...document.querySelectorAll('[data-step]')].map((li) => li.getAttribute('data-state'))
		).toEqual(['ok', 'ok', 'ok', 'ok']);
		expect(text()).toContain('84 ms');
		expect(text()).toContain('Linked');
	});

	it('shows the fleet’s newer word on its link over its own older one, as after Stop', async () => {
		const linked = {
			machine: 'mate-demo',
			here: 'this Mac',
			health: 'linked',
			online: true,
			approved: true,
			problem: null,
			checkedAt: '2026-11-15T13:00:00Z',
			urls: { machines: null, approve: null }
		};
		const fetch = vi.fn(async () => Response.json({ status: linked, job: null }));
		vi.stubGlobal('fetch', fetch);
		const stopping = {
			...linked,
			health: 'down',
			online: false,
			approved: null,
			problem: {
				code: 'stopping',
				text: 'mate-demo is stopping; wake it once it has stopped.',
				action: null
			},
			checkedAt: '2026-11-15T13:05:00Z'
		};
		app = mount(SecondMateCard, {
			target: document.body,
			props: {
				mate: {
					...mate,
					id: 'fleetyard-demo-mate',
					host: 'fy-mate-demo',
					link: { via: 'fleetyard', machine: 'mate-demo', status: stopping as never }
				},
				now: Date.now()
			}
		});
		await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
		flushSync();
		const text = document.body.textContent!.replace(/\s+/g, ' ');
		expect(text).toContain('Stopping');
		expect(text).not.toContain('Online');
	});
});
