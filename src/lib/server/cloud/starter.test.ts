import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeGateway, fingerprintOf } from '../../../../tests/helpers/fake-cloud-gateway';
import { newDeviceKey } from './protocol';
import { CloudSettings } from './settings';
import { RemoteStarter } from './starter';

/** Start and Stop on the Remotes page, against a gateway on loopback. */

let dir: string;
let settings: CloudSettings;
let gw: FakeGateway;
let starter: RemoteStarter;

const until = async (f: () => boolean | Promise<boolean>, ms = 3000) => {
	const end = Date.now() + ms;
	while (!(await f())) {
		if (Date.now() > end) throw new Error('timed out');
		await new Promise((r) => setTimeout(r, 10));
	}
};

beforeEach(async () => {
	dir = await mkdtemp(path.join(tmpdir(), 'wh-remote-starter-'));
	settings = new CloudSettings(path.join(dir, 'cloud'));
	gw = await FakeGateway.start();
	await settings.update((s) => (s.gateway = gw.origin));
	starter = new RemoteStarter({ settings: () => settings, machineName: () => 'Studio Mac' });
});
afterEach(async () => {
	await starter.stop();
	await gw.stop();
	await rm(dir, { recursive: true, force: true });
});

describe('Start', () => {
	it('turns a paired machine on and started at once, with no pairing', async () => {
		const key = newDeviceKey();
		await settings.setKey(key);
		await settings.update((s) => {
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
				decided: null
			};
		});
		expect(await starter.start()).toEqual({ ok: true });
		expect((await settings.read()).settings).toMatchObject({ enabled: true, started: true });
		expect(starter.pairing).toBeNull();
		expect(gw.pairings.size).toBe(0);
	});

	it('pairs an unpaired machine first, showing the code, the gateway’s page and its fingerprint, then starts it', async () => {
		expect(await starter.start()).toEqual({ ok: true });
		const p = await gw.pending();
		const view = (await starter.view()).pairing!;
		expect(view).toMatchObject({
			gateway: gw.origin,
			verificationUri: `${gw.origin}/pair`,
			userCode: p.code,
			fingerprint: fingerprintOf(p.publicKey),
			error: null
		});
		expect(p.name).toBe('Studio Mac');
		// Nothing is started before the captain approves.
		expect((await settings.read()).settings.started).toBe(false);
		// A second Start while it waits starts no second pairing.
		await starter.start();
		expect(gw.pairings.size).toBe(1);

		const deviceId = gw.approve(p.code);
		await until(() => starter.pairing === null);
		const { settings: s } = await settings.read();
		expect(s).toMatchObject({
			enabled: true,
			started: true,
			device: { id: deviceId, name: 'Studio Mac', gateway: gw.origin, user: 'Captain' }
		});
		// The approval signed this machine's challenge, so it pinned the captain's passkeys.
		expect(s.device?.pins).toEqual([gw.passkeys[0].pin]);
		expect((await starter.view()).device?.passkeys).toEqual([
			{ name: 'MacBook Touch ID', fingerprint: fingerprintOf(gw.passkeys[0].publicKey) }
		]);
		expect((await settings.findKey())?.key.publicKey).toBe(p.publicKey);
		// The view carries the fingerprint, never the key.
		expect(JSON.stringify(await starter.view())).not.toContain('privateKey');
	});

	it('says why a denied pairing ended, and keeps nothing', async () => {
		await starter.start();
		const p = await gw.pending();
		p.status = 'denied';
		await until(() => !!starter.pairing?.error);
		expect(starter.pairing!.error).toMatch(/denied on the gateway.*press Start/);
		expect(starter.pairing!.userCode).toBe('');
		expect((await settings.read()).settings.device).toBeNull();
		expect(await settings.findKey()).toBeNull();
	});

	it('keeps nothing when the approval’s passkey signature does not check out here', async () => {
		gw.approvalSignature = (challenge) =>
			gw.passkeys[0].sign(challenge, gw.origin, { origin: 'https://evil.example' });
		await starter.start();
		const deviceId = gw.approve((await gw.pending()).code);
		await until(() => !!starter.pairing?.error);
		expect(starter.pairing!.error).toMatch(/did not check out on this machine.*press Start/);
		expect(gw.unpaired).toEqual([deviceId]);
		expect((await settings.read()).settings).toMatchObject({ started: false, device: null });
		expect(await settings.findKey()).toBeNull();
	});

	it('says when the gateway cannot be reached', async () => {
		await gw.stop();
		const r = await starter.start();
		expect(r.ok).toBe(false);
		expect(!r.ok && r.error).toMatch(/could not be reached/);
		gw = await FakeGateway.start();
	});
});

describe('Stop', () => {
	it('cancels a pairing, so a later approval keeps nothing, and turns remote access off', async () => {
		await starter.start();
		const p = await gw.pending();
		await starter.stop();
		expect(starter.pairing).toBeNull();
		gw.approve(p.code);
		await new Promise((r) => setTimeout(r, 100));
		const { settings: s } = await settings.read();
		expect(s).toMatchObject({ enabled: false, started: false, device: null });
		expect(await settings.findKey()).toBeNull();
	});

	it('turns a started machine off', async () => {
		await settings.update((s) => {
			s.enabled = true;
			s.started = true;
		});
		await starter.stop();
		expect((await settings.read()).settings).toMatchObject({ enabled: false, started: false });
	});
});
