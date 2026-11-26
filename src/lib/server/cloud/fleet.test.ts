import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeGateway } from '../../../../tests/helpers/fake-cloud-gateway';
import type { CloudView } from '../../cloud';
import { fetchFleet, fleetView, FleetSync, parseFleetDocument, type FleetCache } from './fleet';
import { newDeviceKey, type DeviceKey } from './protocol';
import { CloudSettings } from './settings';

/** A ship's fleet document (protocol §6.11), asked of a gateway on loopback and kept beside the settings. */

let dir: string;
let settings: CloudSettings;
let gw: FakeGateway;
let key: DeviceKey;
const DEVICE = '0b0b0b0b-0000-4000-8000-000000000001';

/** A fleet document as Fleetyard sends it: a company fleet with one team. */
function doc(over: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		schema: 'fleetyard-fleet.v1',
		version: 'v-1',
		issued_at: Date.now(),
		refresh_after_s: 900,
		gateway: { url: gw.origin, modules: ['remote-access'] },
		org: { id: 'o-1', slug: 'larkspur', name: 'Larkspur Market', kind: 'company', plan: 'team' },
		me: {
			id: 'u-1',
			name: 'Priya',
			login: 'priya',
			org_role: 'member',
			teams: [{ slug: 'payments', name: 'Payments squad', role: 'member' }]
		},
		ship: { id: DEVICE, name: 'priya-mbp', kind: 'computer' },
		features: {
			remotes: { on: true, limits: { devices: 10, relay_sessions: 10 } },
			cloud_second_mates: {
				on: false,
				reason: 'off_by_org',
				by: 'Dev Kapoor',
				why: 'Larkspur uses machines in its own AWS account.',
				limits: {}
			},
			knowledge: { on: false, reason: 'off_by_org', by: null, limits: {}, teams: ['payments'] },
			events: { on: false, reason: 'not_on_this_gateway', limits: {} },
			sso: { on: false, reason: 'not_in_plan', limits: {} },
			'some.future_feature': { on: true, limits: {} }
		},
		...over
	};
}

async function paired() {
	gw.devices.set(DEVICE, { publicKey: key.publicKey, name: 'priya-mbp', revoked: false });
	await settings.setKey(key);
	await settings.update((s) => {
		s.enabled = true;
		s.gateway = gw.origin;
		s.device = {
			id: DEVICE,
			name: 'priya-mbp',
			gateway: gw.origin,
			publicKey: key.publicKey,
			user: 'Priya',
			pairedAt: new Date().toISOString(),
			pins: null,
			pinnedAt: null,
			pending: null,
			undelivered: []
		};
	});
}

beforeEach(async () => {
	dir = await mkdtemp(path.join(tmpdir(), 'wh-fleet-'));
	settings = new CloudSettings(path.join(dir, 'cloud'));
	gw = await FakeGateway.start();
	key = newDeviceKey();
});
afterEach(async () => {
	await gw.stop();
	await rm(dir, { recursive: true, force: true });
});

describe('asking the gateway', () => {
	it('signs the request with the device key and reads the document', async () => {
		gw.fleet = () => doc();
		await paired();
		const got = await fetchFleet(gw.origin, DEVICE, key);
		expect(got.outcome).toBe('ok');
		expect(gw.fleetRequests).toEqual([{ deviceId: DEVICE, status: 200 }]);
		if (got.outcome !== 'ok') return;
		expect(got.document.org).toMatchObject({ name: 'Larkspur Market', kind: 'company' });
		expect(got.document.features.remotes).toMatchObject({ on: true });
	});

	it('is refused when another key signs', async () => {
		gw.fleet = () => doc();
		await paired();
		const got = await fetchFleet(gw.origin, DEVICE, newDeviceKey());
		expect(got).toMatchObject({ outcome: 'refused' });
	});

	it('says a removed ship must join again, with the gateway’s reason', async () => {
		gw.fleet = () => doc();
		await paired();
		gw.devices.get(DEVICE)!.revoked = true;
		const got = await fetchFleet(gw.origin, DEVICE, key);
		expect(got).toMatchObject({ outcome: 'refused' });
		if (got.outcome === 'refused') expect(got.error).toContain('removed from its fleet');
	});

	it('takes a 404 to mean an older gateway without fleets', async () => {
		await paired();
		expect(await fetchFleet(gw.origin, DEVICE, key)).toEqual({ outcome: 'none' });
	});

	it('says why when the gateway cannot be reached', async () => {
		const got = await fetchFleet('http://127.0.0.1:1', DEVICE, key);
		expect(got).toMatchObject({ outcome: 'error' });
	});

	it('refuses an answer about another ship, or one that is not a fleet document', async () => {
		await paired();
		gw.fleet = () => doc({ ship: { id: 'someone-else', name: 'x', kind: 'computer' } });
		expect(await fetchFleet(gw.origin, DEVICE, key)).toMatchObject({ outcome: 'error' });
		gw.fleet = () => ({ hello: 'world' });
		expect(await fetchFleet(gw.origin, DEVICE, key)).toMatchObject({ outcome: 'error' });
	});
});

describe('the document', () => {
	it('keeps only what may be shown: one-line text, known reasons, bounded refresh', () => {
		const d = parseFleetDocument({
			...doc(),
			refresh_after_s: 1,
			org: { id: 'o', slug: 's', name: 'Evil\nCorp\u2028Ltd', kind: 'weird', plan: 'team' },
			features: {
				remotes: { on: false, reason: 'made_up', limits: { devices: 'ten' } },
				'BAD KEY': { on: true, limits: {} },
				events: { on: 'yes' }
			}
		});
		expect(d?.org).toMatchObject({ name: 'Evil Corp Ltd', kind: 'personal' });
		expect(d?.refresh_after_s).toBe(60);
		expect(d?.features).toEqual({ remotes: { on: false, reason: undefined, limits: {} } });
	});

	it('is not one without its schema, version, org, ship or features', () => {
		for (const drop of ['schema', 'version', 'org', 'ship', 'features']) {
			const d = doc();
			delete d[drop];
			expect(parseFleetDocument(d), drop).toBeNull();
		}
	});
});

describe('FleetSync', () => {
	it('forgets the fleet of a ship that is not paired', async () => {
		const sync = new FleetSync(settings);
		expect(await sync.refresh()).toBeNull();
		expect(gw.fleetRequests).toHaveLength(0);
	});

	it('keeps the answer, readable by the captain only, and asks again only when it is stale', async () => {
		gw.fleet = () => doc();
		await paired();
		let now = Date.now();
		const sync = new FleetSync(settings, { now: () => now });
		const first = await sync.refresh();
		expect(first).toMatchObject({ deviceId: DEVICE, outcome: 'ok', error: null });
		expect(((await stat(sync.file)).mode & 0o777).toString(8)).toBe('600');
		expect(JSON.parse(await readFile(sync.file, 'utf8'))).toMatchObject({
			schema: 'wheelhouse-fleet-cache.v1'
		});
		await sync.refresh();
		expect(gw.fleetRequests).toHaveLength(1);
		now += 901_000;
		await sync.refresh();
		expect(gw.fleetRequests).toHaveLength(2);
	});

	it('asks again on a new version from fleet.changed, and not for the version it holds', async () => {
		gw.fleet = () => doc();
		await paired();
		const sync = new FleetSync(settings);
		await sync.refresh();
		await sync.refresh({ version: 'v-1' });
		expect(gw.fleetRequests).toHaveLength(1);
		gw.fleet = () => doc({ version: 'v-2' });
		expect((await sync.refresh({ version: 'v-2' }))?.document?.version).toBe('v-2');
		expect(gw.fleetRequests).toHaveLength(2);
	});

	it('asks at once on Check now, but not twice within a few seconds', async () => {
		gw.fleet = () => doc();
		await paired();
		let now = Date.now();
		const sync = new FleetSync(settings, { now: () => now });
		await sync.refresh();
		now += 6_000;
		await sync.refresh({ force: true });
		await sync.refresh({ force: true });
		expect(gw.fleetRequests).toHaveLength(2);
	});

	it('keeps showing the last document, with why, while the gateway cannot be reached', async () => {
		gw.fleet = () => doc();
		await paired();
		let now = Date.now();
		const sync = new FleetSync(settings, { now: () => now });
		await sync.refresh();
		await gw.stop();
		now += 901_000;
		const c = await sync.refresh();
		expect(c).toMatchObject({ outcome: 'error', document: { version: 'v-1' } });
		expect(c?.error).toContain('could not be reached');
		gw = await FakeGateway.start();
	});

	it('drops the document once the gateway refuses the ship', async () => {
		gw.fleet = () => doc();
		await paired();
		let now = Date.now();
		const sync = new FleetSync(settings, { now: () => now });
		await sync.refresh();
		gw.devices.get(DEVICE)!.revoked = true;
		now += 901_000;
		expect(await sync.refresh()).toMatchObject({ outcome: 'refused', document: null });
	});

	it('never shows another ship’s answer after leaving and joining again', async () => {
		gw.fleet = () => doc();
		await paired();
		const sync = new FleetSync(settings);
		await sync.refresh();
		await settings.update((s) => (s.device!.id = 'another'));
		expect((await sync.read())?.deviceId).toBe(DEVICE);
		const cloud = { ...(await settings.view()), pairing: null };
		expect(fleetView(cloud, await sync.read()).state).toBe('unknown');
	});
});

describe('what Settings → Fleet shows', () => {
	const cloud = (over: Partial<CloudView> = {}): CloudView => ({
		schema: 'wheelhouse-cloud.v1',
		enabled: true,
		started: false,
		gateway: 'https://fleetyard.io',
		device: {
			id: DEVICE,
			name: 'priya-mbp',
			user: 'Priya',
			fingerprint: 'ABCD-EFGH-IJKL-MNOP',
			pairedAt: new Date().toISOString(),
			passkeys: null,
			pinnedAt: null,
			pending: null
		},
		keyStore: null,
		state: 'off',
		reason: null,
		since: null,
		lastSeen: null,
		sessions: [],
		viaRelay: false,
		pairing: null,
		...over
	});
	const cache = (over: Partial<FleetCache> = {}): FleetCache => ({
		deviceId: DEVICE,
		gateway: 'https://fleetyard.io',
		checkedAt: new Date().toISOString(),
		outcome: 'ok',
		error: null,
		document: parseFleetDocument(doc()),
		...over
	});

	it('asks a ship not paired to join, with Fleetyard as the gateway', () => {
		const v = fleetView(cloud({ device: null }), null);
		expect(v).toMatchObject({ state: 'not-joined', fleetyard: true, fleet: null, features: [] });
	});

	it('names the fleet, the role, and each feature this ship may use, with why others are off', () => {
		const v = fleetView(cloud(), cache());
		expect(v.state).toBe('joined');
		expect(v.fleet).toMatchObject({
			name: 'Larkspur Market',
			kind: 'company',
			plan: 'team',
			role: 'member',
			teams: [{ slug: 'payments', name: 'Payments squad', role: 'member' }]
		});
		const by = Object.fromEntries(v.features.map((f) => [f.key, f]));
		expect(by.remotes).toMatchObject({ on: true, note: null });
		expect(by.cloud_second_mates).toMatchObject({
			on: false,
			reason: 'off_by_org',
			note: 'Switched off for Larkspur Market by Dev Kapoor.',
			why: 'Larkspur uses machines in its own AWS account.'
		});
		// Off for the fleet, switched on by a team admin for the captain's team.
		expect(by.knowledge).toMatchObject({ on: true, note: 'Only for Payments squad.' });
		expect(by.events).toMatchObject({ on: false, note: 'This gateway doesn’t offer it.' });
		expect(by.sso).toMatchObject({ on: false, reason: 'not_in_plan' });
		// A key this Wheelhouse doesn't know is ignored.
		expect(by['some.future_feature']).toBeUndefined();
	});

	it('says an older gateway has no fleets, and a refused ship why', () => {
		expect(fleetView(cloud(), cache({ outcome: 'none', document: null })).state).toBe('no-fleets');
		const refused = fleetView(
			cloud(),
			cache({ outcome: 'refused', document: null, error: 'Join again.' })
		);
		expect(refused).toMatchObject({ state: 'refused', error: 'Join again.' });
	});

	it('keeps the last answer when the gateway could not be asked, with why', () => {
		const v = fleetView(cloud(), cache({ outcome: 'error', error: 'unreachable' }));
		expect(v).toMatchObject({ state: 'joined', error: 'unreachable' });
	});
});
