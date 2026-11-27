import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeGateway } from '../../../../tests/helpers/fake-cloud-gateway';
import { FLEET_CACHE_SCHEMA, FleetSync } from './fleet';
import { DevPortal, parseAnswer, parseRecord, portalGet, portalOn } from './portal';
import { newDeviceKey, type DeviceKey } from './protocol';
import { CloudSettings } from './settings';

/** A ship's teams' dev portals (protocol §6.12), read from a gateway on loopback. */

let dir: string;
let settings: CloudSettings;
let fleet: FleetSync;
let gw: FakeGateway;
let key: DeviceKey;
const DEVICE = '0b0b0b0b-0000-4000-8000-000000000002';
const SCHEMA = 'fleetyard-portal.v1';
const FY = 'https://fleetyard.io/t/payments/portal';

const code = (o: Record<string, unknown>) => ({
	source: 'codebase',
	filedBy: 'firstmate (codex)',
	for: 'priya-nair',
	relayed: true,
	confirmed: true,
	observedAt: '2026-11-25T10:00:00.000Z',
	...o
});

/** POST /v2/refunds as Fleetyard answers it to Priya, whose checkout-service calls it. */
const refunds = () => ({
	id: 'api.refunds-create',
	type: 'api',
	typeName: 'API',
	title: 'POST /v2/refunds',
	summary: 'Refunds all or part of a payment.',
	attributes: { kind: 'rest', method: 'POST', path: '/v2/refunds', auth: 'payments:write' },
	evidence: [
		code({
			note: 'reason_code is now required (payments-api#412).',
			filedBy: 'firstmate (claude-code)',
			for: 'marcus-bell'
		})
	],
	owners: [{ id: 'person.marcus-bell', title: 'Marcus Bell', type: 'person', evidence: [] }],
	links: [
		{
			rel: 'exposes',
			direction: 'in',
			id: 'service.payments-api',
			title: 'payments-api',
			type: 'service',
			fullPage: `${FY}/services/payments-api`,
			evidence: [code({})]
		},
		{
			rel: 'calls',
			direction: 'in',
			id: 'service.checkout-service',
			title: 'checkout-service',
			type: 'service',
			fullPage: `${FY}/services/checkout-service`,
			evidence: [code({ note: 'Sends amount and payment_id; no reason_code yet.' })]
		}
	],
	touchesYou: {
		known: true,
		youOwn: false,
		yoursCallIt: [
			{
				id: 'service.checkout-service',
				title: 'checkout-service',
				type: 'service',
				evidence: [code({ note: 'Sends amount and payment_id; no reason_code yet.' })]
			}
		],
		itCallsYours: []
	},
	confirmed: { facts: 2, of: 3 },
	notKnown: [],
	fullPage: `${FY}/apis/refunds-create`,
	updatedAt: '2026-11-26T10:00:00.000Z'
});

/** The fleet document kept for this ship, with the dev portal as `knowledge` says. */
async function keptFleet(knowledge: Record<string, unknown> | null, deviceId = DEVICE) {
	await writeFile(
		fleet.file,
		JSON.stringify({
			schema: FLEET_CACHE_SCHEMA,
			deviceId,
			gateway: gw.origin,
			checkedAt: new Date().toISOString(),
			outcome: 'ok',
			error: null,
			document: {
				schema: 'fleetyard-fleet.v1',
				version: 'v-1',
				issued_at: Date.now(),
				refresh_after_s: 900,
				gateway: { url: gw.origin, modules: [] },
				org: {
					id: 'o-1',
					slug: 'larkspur',
					name: 'Larkspur Market',
					kind: 'company',
					plan: 'team'
				},
				me: { id: 'u-1', name: 'Priya', login: 'priya-nair', org_role: 'member', teams: [] },
				ship: { id: deviceId, name: 'priya-mbp', kind: 'computer' },
				features: knowledge ? { knowledge } : {}
			}
		})
	);
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
	dir = await mkdtemp(path.join(tmpdir(), 'wh-portal-'));
	settings = new CloudSettings(path.join(dir, 'cloud'));
	// The kept fleet document is what these tests set; the gateway is never asked for it again.
	fleet = new FleetSync(settings);
	fleet.refresh = async () => null;
	gw = await FakeGateway.start();
	key = newDeviceKey();
});
afterEach(async () => {
	await gw.stop();
	await rm(dir, { recursive: true, force: true });
});

describe('signed reads', () => {
	it('signs the path with its query as the gateway reads it, a question’s apostrophe too', async () => {
		await paired();
		gw.portal = (_id, p) => ({
			status: 200,
			body: { schema: SCHEMA, q: p, notRecorded: true, matches: [] }
		});
		const got = await portalGet(
			gw.origin,
			DEVICE,
			key,
			`/v1/portal/teams/payments/ask?q=${encodeURIComponent("who's calling it?")}`
		);
		expect(got.ok).toBe(true);
		expect(gw.portalRequests).toEqual([
			{ pathAndQuery: '/v1/portal/teams/payments/ask?q=who%27s%20calling%20it%3F', status: 200 }
		]);
	});

	it('is refused when another key signs, and says to join again', async () => {
		await paired();
		gw.portal = () => ({ status: 200, body: {} });
		const got = await portalGet(gw.origin, DEVICE, newDeviceKey(), '/v1/portal');
		expect(got).toEqual({
			ok: false,
			status: 401,
			message: 'Fleetyard no longer knows this ship. Join the fleet again in Settings → Fleet.'
		});
	});

	it('gives the gateway’s refusals in plain words', async () => {
		await paired();
		gw.portal = (_id, p) =>
			p.includes('records')
				? {
						status: 404,
						body: {
							error: 'not_recorded',
							message: "Not recorded in Docket: the team's record has no api.nope."
						}
					}
				: { status: 409, body: { error: 'no_docket', message: 'no docket' } };
		expect(
			await portalGet(gw.origin, DEVICE, key, '/v1/portal/teams/payments/records/api.nope')
		).toMatchObject({
			ok: false,
			status: 404,
			message: "Not recorded in Docket: the team's record has no api.nope."
		});
		expect(await portalGet(gw.origin, DEVICE, key, '/v1/portal/teams/payments')).toMatchObject({
			ok: false,
			status: 409,
			message: 'This team has no dev portal yet: its admin sets one up on Fleetyard.'
		});
	});

	it('says so when the gateway cannot be reached', async () => {
		const got = await portalGet('http://127.0.0.1:9', DEVICE, key, '/v1/portal');
		expect(got).toMatchObject({ ok: false, status: 0 });
	});
});

describe('reading the answers', () => {
	it('keeps a record’s basics and how it touches you', () => {
		const r = parseRecord(refunds())!;
		expect(r.title).toBe('POST /v2/refunds');
		expect(r.attributes).toContainEqual({ key: 'auth', value: 'payments:write' });
		expect(r.touchesYou.yoursCallIt.map((t) => t.title)).toEqual(['checkout-service']);
		expect(r.evidence[0]).toMatchObject({
			note: 'reason_code is now required (payments-api#412).',
			confirmed: true
		});
		expect(r.fullPage).toBe(`${FY}/apis/refunds-create`);
	});

	it('links only to http and https addresses, and keeps text to one line', () => {
		const r = parseRecord({
			...refunds(),
			fullPage: 'javascript:alert(1)',
			title: 'POST\n/v2/refunds ',
			environments: [
				{
					title: 'Production',
					attributes: { apiDocs: 'data:text/html,hi', dashboard: 'https://grafana.test/d/1' }
				}
			]
		})!;
		expect(r.fullPage).toBeNull();
		expect(r.title).toBe('POST /v2/refunds');
		expect(r.environments).toEqual([
			{ title: 'Production', links: [{ label: 'Dashboard', url: 'https://grafana.test/d/1' }] }
		]);
	});

	it('reads nothing into an answer of another kind', () => {
		expect(parseRecord({ title: 'no id' })).toBeNull();
		expect(parseAnswer({ matches: [] })).toBeNull();
		expect(parseAnswer({ schema: SCHEMA, q: 'flags', matches: [] })).toMatchObject({
			notRecorded: true
		});
	});
});

describe('when the dev portal is shown', () => {
	it('is hidden on a ship that is not paired', async () => {
		const portal = new DevPortal(settings, fleet);
		expect(await portal.shown()).toBe(false);
		expect(await portal.record('payments', 'api.refunds-create')).toBeNull();
	});

	it('is hidden while the fleet’s dev portal is off, or the fleet kept is another ship’s', async () => {
		await paired();
		const portal = new DevPortal(settings, fleet);
		await keptFleet(null);
		expect(await portal.shown()).toBe(false);
		await keptFleet({ on: false, reason: 'not_in_plan', limits: {} });
		expect(await portal.shown()).toBe(false);
		await keptFleet({ on: true, limits: {} }, 'another-ship');
		expect(await portal.shown()).toBe(false);
		expect(gw.portalRequests).toEqual([]);
	});

	it('is shown when it is on for the fleet, or for some of the captain’s teams', () => {
		const cache = (knowledge: Record<string, unknown>) =>
			({ document: { features: { knowledge } } }) as unknown as Parameters<typeof portalOn>[0];
		expect(portalOn(cache({ on: true, limits: {} }))).toBe(true);
		expect(
			portalOn(cache({ on: false, reason: 'off_by_org', limits: {}, teams: ['payments'] }))
		).toBe(true);
		expect(portalOn(cache({ on: false, reason: 'off_by_org', limits: {} }))).toBe(false);
		expect(portalOn(null)).toBe(false);
	});

	it('reads a record’s basics, with its team, as the ship', async () => {
		await paired();
		await keptFleet({ on: true, limits: {} });
		gw.portal = (id, p) =>
			id === DEVICE && p === '/v1/portal/teams/payments/records/api.refunds-create'
				? {
						status: 200,
						body: {
							schema: SCHEMA,
							team: { slug: 'payments', name: 'Payments squad' },
							record: refunds()
						}
					}
				: { status: 404, body: { error: 'not_found' } };
		const portal = new DevPortal(settings, fleet);
		expect(await portal.shown()).toBe(true);
		const got = await portal.record('payments', 'api.refunds-create');
		expect(got?.ok).toBe(true);
		if (!got?.ok) return;
		expect(got.value.team).toEqual({ slug: 'payments', name: 'Payments squad' });
		expect(got.value.record.owners.map((o) => o.title)).toEqual(['Marcus Bell']);
	});
});
