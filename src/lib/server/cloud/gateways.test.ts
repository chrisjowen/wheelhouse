import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeGateway } from '../../../../tests/helpers/fake-cloud-gateway';
import { DEFAULT_GATEWAY } from '../../cloud';
import { addGateway, editGateway, removeGateway, switchGateway } from './gateways';
import { keepDevice } from './pairing';
import { newDeviceKey } from './protocol';
import { CloudSettings, FIRST_GATEWAY_ID } from './settings';

/** The gateways saved on Settings → Fleet, each with its own pairing and key. */

let dir: string;
let settings: CloudSettings;
let gw: FakeGateway;

beforeEach(async () => {
	dir = await mkdtemp(path.join(tmpdir(), 'wh-gateways-'));
	settings = new CloudSettings(path.join(dir, 'cloud'));
	gw = await FakeGateway.start();
});
afterEach(async () => {
	await gw.stop();
	await rm(dir, { recursive: true, force: true });
});

/** Pair the gateway in use, as an approved Join leaves it. */
async function pairHere(id = 'd-1') {
	const key = newDeviceKey();
	const { settings: s } = await settings.read();
	gw.devices.set(id, { publicKey: key.publicKey, name: 'Mac', revoked: false });
	await keepDevice(settings, s.gateway, key, 'Mac', {
		deviceId: id,
		name: 'Mac',
		user: null,
		pins: null
	});
	return key;
}

const ids = async () => (await settings.read()).settings.gateways.map((g) => g.name);

describe('saved gateways', () => {
	it('starts with Fleetyard, in use', async () => {
		const { settings: s } = await settings.read();
		expect(s.activeId).toBe(FIRST_GATEWAY_ID);
		expect(s.gateways).toEqual([
			{ id: FIRST_GATEWAY_ID, name: 'Fleetyard', gateway: DEFAULT_GATEWAY, device: null }
		]);
	});

	it('reads a settings file from before gateways were saved as one gateway, in use, keeping its pairing', async () => {
		const key = newDeviceKey();
		await settings.setKey(key);
		await writeFile(
			settings.file,
			JSON.stringify({
				schema: 'wheelhouse-cloud-settings.v1',
				profileName: 'Studio',
				enabled: true,
				started: true,
				gateway: gw.origin,
				device: { id: 'd-0', name: 'Mac', gateway: gw.origin, publicKey: key.publicKey }
			})
		);
		const { settings: s } = await settings.read();
		expect(s.gateways).toEqual([
			{ id: FIRST_GATEWAY_ID, name: 'Studio', gateway: gw.origin, device: null }
		]);
		expect(s.device?.keySlot).toBeNull();
		expect((await settings.findKey())?.key.publicKey).toBe(key.publicKey);
	});

	it('adds, renames and readdresses a gateway, and refuses bad or repeated addresses', async () => {
		expect(
			await addGateway(settings, { name: 'Ours', gateway: 'https://gw.example.org/' })
		).toEqual({
			ok: true
		});
		expect(await ids()).toEqual(['Fleetyard', 'Ours']);
		for (const bad of [
			{ name: '', gateway: 'https://x.example.org' },
			{ name: 'X', gateway: 'http://x.example.org' },
			{ name: 'X', gateway: 'https://x.example.org/pair' }
		])
			expect((await addGateway(settings, bad)).ok).toBe(false);
		expect(
			await addGateway(settings, { name: 'Again', gateway: 'https://gw.example.org' })
		).toMatchObject({
			ok: false,
			status: 409
		});
		const id = (await settings.read()).settings.gateways[1].id;
		await editGateway(settings, { id, name: 'Lab', gateway: 'https://lab.example.org' }, false);
		expect((await settings.read()).settings.gateways[1]).toMatchObject({
			name: 'Lab',
			gateway: 'https://lab.example.org'
		});
		// The one in use is renamed in the settings themselves.
		await editGateway(
			settings,
			{ id: FIRST_GATEWAY_ID, name: 'Fleetyard (work)', gateway: DEFAULT_GATEWAY },
			false
		);
		expect((await settings.read()).settings.profileName).toBe('Fleetyard (work)');
	});

	it('keeps the address of a gateway this ship is paired with', async () => {
		await editGateway(settings, { id: FIRST_GATEWAY_ID, name: 'Local', gateway: gw.origin }, false);
		await pairHere();
		const r = await editGateway(
			settings,
			{ id: FIRST_GATEWAY_ID, name: 'Local', gateway: 'https://elsewhere.example.org' },
			false
		);
		expect(r).toMatchObject({ ok: false, status: 409 });
		// Renaming it is fine.
		expect(
			await editGateway(
				settings,
				{ id: FIRST_GATEWAY_ID, name: 'Renamed', gateway: gw.origin },
				false
			)
		).toEqual({ ok: true });
	});

	it('switches: the one in use keeps its pairing and key, the chosen one needs a Join', async () => {
		await editGateway(settings, { id: FIRST_GATEWAY_ID, name: 'Local', gateway: gw.origin }, false);
		const firstKey = await pairHere('d-1');
		await settings.update((s) => (s.started = true));
		await addGateway(settings, { name: 'Fleetyard', gateway: DEFAULT_GATEWAY });
		const other = (await settings.read()).settings.gateways[1].id;

		expect(await switchGateway(settings, other)).toEqual({ ok: true, needsJoin: true });
		let s = (await settings.read()).settings;
		expect(s).toMatchObject({
			activeId: other,
			gateway: DEFAULT_GATEWAY,
			device: null,
			started: false
		});
		expect(s.gateways[0].device?.id).toBe('d-1');
		expect((await settings.findKey(null))?.key.publicKey).toBe(firstKey.publicKey);

		// A pairing made here goes in this gateway's own key slot, apart from the first's.
		const otherKey = await pairHere('d-2');
		s = (await settings.read()).settings;
		expect(s.device?.keySlot).toBe(other);
		expect((await stat(settings.keyFileFor(other))).mode & 0o777).toBe(0o600);
		expect((await settings.findKey())?.key.publicKey).toBe(otherKey.publicKey);
		expect((await settings.findKey(null))?.key.publicKey).toBe(firstKey.publicKey);

		// Switching back needs no new Join.
		expect(await switchGateway(settings, FIRST_GATEWAY_ID)).toEqual({ ok: true, needsJoin: false });
		s = (await settings.read()).settings;
		expect(s).toMatchObject({ activeId: FIRST_GATEWAY_ID, gateway: gw.origin, enabled: true });
		expect(s.device?.id).toBe('d-1');
		expect((await settings.findKey())?.key.publicKey).toBe(firstKey.publicKey);
		expect(s.gateways[1].device?.id).toBe('d-2');
	});

	it('pairs again on switching to a gateway whose key went missing', async () => {
		await addGateway(settings, { name: 'Local', gateway: gw.origin });
		const local = (await settings.read()).settings.gateways[1].id;
		await switchGateway(settings, local);
		await pairHere('d-3');
		await switchGateway(settings, FIRST_GATEWAY_ID);
		await rm(settings.keyFileFor(local));
		expect(await switchGateway(settings, local)).toEqual({ ok: true, needsJoin: true });
		expect((await settings.read()).settings.device).toBeNull();
	});

	it('removes a gateway not in use, revoking its pairing there and deleting its key', async () => {
		await addGateway(settings, { name: 'Local', gateway: gw.origin });
		const local = (await settings.read()).settings.gateways[1].id;
		expect(await removeGateway(settings, FIRST_GATEWAY_ID)).toMatchObject({
			ok: false,
			status: 409
		});
		await switchGateway(settings, local);
		await pairHere('d-4');
		await switchGateway(settings, FIRST_GATEWAY_ID);
		expect(await removeGateway(settings, local)).toEqual({ ok: true });
		expect(gw.unpaired).toEqual(['d-4']);
		expect(await ids()).toEqual(['Fleetyard']);
		await expect(stat(settings.keyFileFor(local))).rejects.toThrow();
		// The file names no removed gateway's pairing.
		expect(await readFile(settings.file, 'utf8')).not.toContain('d-4');
	});

	it('says when a removed gateway could not be told, deleting the key anyway', async () => {
		await addGateway(settings, { name: 'Local', gateway: gw.origin });
		const local = (await settings.read()).settings.gateways[1].id;
		await switchGateway(settings, local);
		await pairHere('d-5');
		await switchGateway(settings, FIRST_GATEWAY_ID);
		await gw.stop();
		const r = await removeGateway(settings, local);
		expect(r).toMatchObject({ ok: true });
		expect(r.ok && r.note).toContain('could not be told');
		await expect(stat(settings.keyFileFor(local))).rejects.toThrow();
		gw = await FakeGateway.start();
	});
});
