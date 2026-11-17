import { flushSync, mount, tick, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

/*
 * The Add second mate wizard's Fleetyard path: a paired computer goes straight from where to
 * run to the mate's details, picks a size for a brand-new machine, and Launch asks Fleetyard
 * for that machine, waits for the passkey approval and for the machine to come up, then hands
 * the mate to Firstmate to seed and start. Every request that changes anything carries the
 * Wheelhouse session token.
 */

vi.mock('$app/state', () => ({ page: { data: { sessionToken: 'tok' } } }));
vi.mock('$lib/client/live.svelte', () => ({
	currentFleet: () => ({ projects: [{ id: 'wheelhouse', name: 'wheelhouse' }] })
}));

const { default: Wizard } = await import('./AddSecondMateWizard.svelte');

const GATEWAY = 'https://fleetyard.io';
const SETUP = {
	gateway: GATEWAY,
	cloud: { gateway: GATEWAY, device: { id: 'device-1', gateway: GATEWAY } },
	deviceError: null,
	sshKeys: [{ id: 'SHA256:abc', label: 'laptop' }],
	vaultNames: []
};
const MACHINE = {
	id: '6f1c2d3e-4a5b-4c6d-8e7f-0a1b2c3d4e5f',
	name: 'phoenix',
	state: 'running',
	phase: 'reachable',
	reachable: true,
	keysReady: true,
	matesRefused: null,
	targetFingerprint: 'ABCD-EFGH',
	size: 'medium',
	region: 'us-east-1',
	runtimes: null
};

let app: ReturnType<typeof mount> | null = null;
afterEach(() => {
	if (app) unmount(app);
	app = null;
	document.body.innerHTML = '';
	vi.unstubAllGlobals();
});

const settle = async () => {
	for (let i = 0; i < 6; i++) {
		await new Promise((r) => setTimeout(r, 0));
		await tick();
	}
	flushSync();
};
const button = (text: string) =>
	[...document.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
		b.textContent?.includes(text)
	)!;
const type = (placeholder: string, value: string) => {
	const input = document.querySelector<HTMLInputElement>(`input[placeholder="${placeholder}"]`)!;
	input.value = value;
	input.dispatchEvent(new Event('input'));
	flushSync();
};

describe('the Add second mate wizard on Fleetyard', () => {
	it('launches the mate on a new machine, never offering an existing one', async () => {
		const posts: { body: Record<string, unknown>; token: string | null }[] = [];
		let phase = 'approve';
		vi.stubGlobal(
			'fetch',
			vi.fn(async (url: string, init?: RequestInit) => {
				if (!init?.method) return Response.json(SETUP);
				const body = JSON.parse(String(init.body)) as Record<string, unknown>;
				posts.push({ body, token: new Headers(init.headers).get('x-wheelhouse-session') });
				if (body.action === 'create-machine')
					return Response.json({
						launch: { state: phase === 'approve' ? 'pending' : 'launching', phase, message: null },
						approve: phase === 'approve' ? `${GATEWAY}/mates/launch/l1` : null,
						sshCode: '7A4J RXYL',
						machine: phase === 'approve' ? null : MACHINE,
						message: phase === 'seed' ? { delivery: 'delivered' } : null
					});
				return Response.json({ message: 'unexpected' }, { status: 400 });
			})
		);
		app = mount(Wizard, { target: document.body });
		await settle();

		expect(document.body.textContent).toContain('New Fleetyard machine');
		button('Continue').click();
		flushSync();
		// Paired already: straight to the details, no sign-in step and no machine list.
		expect(document.body.textContent).toContain('Give this second mate a name');
		expect(document.body.textContent).not.toContain('Choose a machine');
		type('phoenix', 'phoenix');
		type('Docket work', 'Releases');
		button('Continue').click();
		flushSync();

		expect(document.body.textContent).toContain('A new machine for phoenix');
		document.querySelector<HTMLInputElement>('input[name="machine-size"][value="medium"]')!.click();
		flushSync();
		button('Review launch').click();
		flushSync();
		expect(document.body.textContent).toContain('New medium Fleetyard machine');

		button('Launch second mate').click();
		await settle();
		const approve = [...document.querySelectorAll('a')].find((a) =>
			a.textContent?.includes('Approve on Fleetyard')
		);
		expect(approve?.getAttribute('href')).toBe(`${GATEWAY}/mates/launch/l1`);
		expect(document.body.textContent).toContain('7A4J RXYL');

		phase = 'provisioning';
		document.dispatchEvent(new Event('visibilitychange'));
		await settle();
		expect(document.body.textContent).toContain('Fleetyard is building the machine');

		phase = 'seed';
		document.dispatchEvent(new Event('visibilitychange'));
		await settle();

		expect(document.body.textContent).toContain('phoenix is being set up');
		expect(document.body.textContent).toContain('Firstmate has been asked to seed');
		expect(posts.map((p) => p.body.action)).toEqual([
			'create-machine',
			'create-machine',
			'create-machine'
		]);
		expect(posts.every((p) => p.token === 'tok')).toBe(true);
		const [first, ...rest] = posts.map((p) => p.body);
		expect(first).toMatchObject({
			name: 'phoenix',
			charter: 'Releases',
			projects: [],
			size: 'medium',
			region: 'us-east-1',
			keyId: 'SHA256:abc'
		});
		// Polling repeats the same launch: same ids and fields, or Fleetyard answers 409.
		for (const again of rest) expect(again).toEqual(first);
	});
});
