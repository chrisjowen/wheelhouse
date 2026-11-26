import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeGateway } from '../../../../../tests/helpers/fake-cloud-gateway';
import { DEFAULT_GATEWAY } from '$lib/cloud';
import type { FleetView } from '$lib/fleet';
import { FleetSync } from '$lib/server/cloud/fleet';
import { newDeviceKey } from '$lib/server/cloud/protocol';
import { CloudSettings } from '$lib/server/cloud/settings';
import { remoteStarter } from '$lib/server/cloud/starter';

/**
 * GET and POST /api/fleet/membership, as Settings → Fleet calls them, on a
 * temporary config directory (no Keychain) and a gateway on loopback. Origin,
 * the session token and captain-only are hooks.server.ts's, tested with it.
 */

let dir: string;
let settings: CloudSettings;
let fleet: FleetSync;
let gw: FakeGateway;

vi.mock('$lib/server/cloud/local', () => ({
	cloudKeychain: () => null,
	cloudSettings: () => settings,
	localFleet: () => fleet
}));

const { GET, POST } = await import('./+server');
const { fleetPage } = await import('$lib/server/cloud/page');

const ORIGIN = 'http://127.0.0.1:4310';
type Event = Parameters<typeof POST>[0];
const RELAYED = { 'x-wheelhouse-remote': '1' };

function get(headers: Record<string, string> = {}) {
	const request = new Request(`${ORIGIN}/api/fleet/membership`, { headers });
	return GET({ request } as unknown as Event) as Promise<Response>;
}
function post(body: object, headers: Record<string, string> = {}) {
	const request = new Request(`${ORIGIN}/api/fleet/membership`, {
		method: 'POST',
		headers: { 'content-type': 'application/json', ...headers },
		body: JSON.stringify(body)
	});
	return POST({ request } as unknown as Event) as Promise<Response>;
}
const viewOf = async (r: Response) => ((await r.json()) as { view: FleetView }).view;

const document = (id: string) => ({
	schema: 'fleetyard-fleet.v1',
	version: 'v-1',
	issued_at: Date.now(),
	refresh_after_s: 900,
	org: { id: 'o-1', slug: 'captain', name: 'Captain', kind: 'personal', plan: 'beta' },
	me: { id: 'u-1', name: 'Captain', login: 'captain', org_role: 'owner', teams: [] },
	ship: { id, name: 'Studio Mac', kind: 'computer' },
	features: { remotes: { on: true, limits: {} } }
});

async function paired() {
	const key = newDeviceKey();
	gw.devices.set('d-1', { publicKey: key.publicKey, name: 'Mac', revoked: false });
	await settings.setKey(key);
	await settings.update((s) => {
		s.gateway = gw.origin;
		s.enabled = true;
		s.device = {
			id: 'd-1',
			name: 'Mac',
			gateway: gw.origin,
			publicKey: key.publicKey,
			user: null,
			pairedAt: new Date().toISOString(),
			pins: null,
			pinnedAt: null,
			pending: null,
			undelivered: []
		};
	});
}

beforeEach(async () => {
	dir = mkdtempSync(path.join(tmpdir(), 'wh-fleet-route-'));
	settings = new CloudSettings(path.join(dir, 'cloud'));
	fleet = new FleetSync(settings);
	gw = await FakeGateway.start();
});
afterEach(async () => {
	await remoteStarter().stop();
	await gw.stop();
	rmSync(dir, { recursive: true, force: true });
});

describe('/api/fleet/membership', () => {
	it('shows a ship not in a fleet, on Fleetyard by default', async () => {
		const v = (await (await get()).json()) as FleetView;
		expect(v).toMatchObject({
			state: 'not-joined',
			gateway: DEFAULT_GATEWAY,
			fleetyard: true,
			pairing: null
		});
	});

	it('joins through the gateway named, leaving remote access off', async () => {
		gw.fleet = document;
		let v = await viewOf(await post({ action: 'join', gateway: gw.origin }));
		const p = await gw.pending();
		expect(v).toMatchObject({ state: 'not-joined', fleetyard: false, gateway: gw.origin });
		expect(v.pairing).toMatchObject({ userCode: p.code, verificationUri: `${gw.origin}/pair` });
		gw.approve(p.code);
		for (let i = 0; i < 300 && !(await settings.read()).settings.device; i++)
			await new Promise((r) => setTimeout(r, 10));
		expect((await settings.read()).settings).toMatchObject({ enabled: true, started: false });
		v = (await (await get()).json()) as FleetView;
		expect(v).toMatchObject({
			state: 'joined',
			pairing: null,
			fleet: { name: 'Captain', kind: 'personal', role: 'owner' }
		});
		expect(v.features.map((f) => [f.key, f.on])).toEqual([['remotes', true]]);
	});

	it('cancels a Join waiting for approval', async () => {
		await post({ action: 'join', gateway: gw.origin });
		await gw.pending();
		const v = await viewOf(await post({ action: 'cancel' }));
		expect(v.pairing).toBeNull();
		expect((await settings.read()).settings.device).toBeNull();
	});

	it('refuses a bad gateway, and a second fleet while in one', async () => {
		for (const gateway of ['http://gw.example.org', 'https://gw.example.org/pair', 42]) {
			expect((await post({ action: 'join', gateway })).status).toBe(400);
		}
		await paired();
		expect((await post({ action: 'join', gateway: gw.origin })).status).toBe(409);
		expect(gw.pairings.size).toBe(0);
	});

	it('works with an older gateway that has no fleets', async () => {
		await paired();
		const v = (await (await get()).json()) as FleetView;
		expect(v).toMatchObject({ state: 'no-fleets', fleet: null, error: null });
	});

	it('asks the gateway again on Check now', async () => {
		gw.fleet = document;
		await paired();
		await get();
		const v = await viewOf(await post({ action: 'check' }));
		expect(v.state).toBe('joined');
		expect(gw.fleetRequests.length).toBeGreaterThanOrEqual(1);
	});

	it('leaves: the gateway forgets the ship, and its key and fleet go here', async () => {
		gw.fleet = document;
		await paired();
		await get();
		expect(await fleet.read()).not.toBeNull();
		const v = await viewOf(await post({ action: 'leave' }));
		expect(v.state).toBe('not-joined');
		expect(gw.unpaired).toEqual(['d-1']);
		expect(await settings.findKey()).toBeNull();
		expect(await fleet.read()).toBeNull();
		expect((await settings.read()).settings).toMatchObject({ enabled: false, started: false });
	});

	it('answers only on this machine: never a request that came through the cloud', async () => {
		await paired();
		expect((await get(RELAYED)).status).toBe(403);
		for (const body of [
			{ action: 'join', gateway: 'https://evil.example' },
			{ action: 'cancel' },
			{ action: 'check' },
			{ action: 'leave' }
		]) {
			expect((await post(body, RELAYED)).status).toBe(403);
		}
		expect((await settings.read()).settings.device?.id).toBe('d-1');
		const relayedPage = new Request(`${ORIGIN}/settings/fleet`, { headers: RELAYED });
		expect(await fleetPage(relayedPage)).toEqual({ view: null, gateway: gw.origin });
	});

	it('refuses an unknown action', async () => {
		expect((await post({ action: 'sink' })).status).toBe(400);
	});
});
