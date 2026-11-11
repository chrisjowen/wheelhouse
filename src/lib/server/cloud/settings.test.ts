import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Keychain } from '../gateway/keychain';
import { DEFAULT_GATEWAY } from '../../cloud';
import { exportKey, newDeviceKey } from './protocol';
import { CloudSettings, gatewayOrigin } from './settings';

let dir: string;
beforeEach(async () => (dir = await mkdtemp(path.join(tmpdir(), 'wh-cloud-settings-'))));
afterEach(() => rm(dir, { recursive: true, force: true }));

const device = (gateway = 'https://cloud.example.com') => ({
	id: 'd-1',
	name: 'Mac',
	gateway,
	publicKey: newDeviceKey().publicKey,
	user: null,
	pairedAt: '2026-11-10T00:00:00.000Z'
});

describe('gatewayOrigin', () => {
	it('takes an https origin, or http on this computer only', () => {
		expect(gatewayOrigin(' https://Cloud.Example.com/ ')).toEqual({
			ok: true,
			origin: 'https://cloud.example.com'
		});
		expect(gatewayOrigin('http://127.0.0.1:8080')).toEqual({
			ok: true,
			origin: 'http://127.0.0.1:8080'
		});
		for (const bad of [
			'http://cloud.example.com',
			'https://cloud.example.com/pair',
			'https://u:p@x.com',
			'ftp://x',
			'x'
		]) {
			expect(gatewayOrigin(bad).ok).toBe(false);
		}
	});
});

describe('CloudSettings', () => {
	it('is off, not started, on the default gateway with no device until the captain sets them', async () => {
		const s = new CloudSettings(dir);
		expect((await s.read()).settings).toEqual({
			enabled: false,
			started: false,
			gateway: DEFAULT_GATEWAY,
			device: null
		});
		expect(DEFAULT_GATEWAY).toBe('https://cloud.chrisjowen.net');
		const v = await s.view();
		expect(v.state).toBe('off');
		expect(v.gateway).toBe(DEFAULT_GATEWAY);
	});

	it('keeps only a gateway the captain named, so the default stays one constant', async () => {
		const s = new CloudSettings(dir);
		await s.update((x) => (x.enabled = true));
		expect(JSON.parse(await readFile(s.file, 'utf8')).gateway).toBe('');
		await s.update((x) => (x.gateway = 'https://gw.example.org'));
		expect((await s.read()).settings.gateway).toBe('https://gw.example.org');
		await s.update((x) => (x.gateway = ''));
		expect((await s.read()).settings.gateway).toBe(DEFAULT_GATEWAY);
	});

	it('is off, still paired, when paired and on but never started (an old settings file too)', async () => {
		const s = new CloudSettings(dir);
		const d = device();
		await s.setKey(newDeviceKey());
		await writeFile(
			s.file,
			JSON.stringify({
				schema: 'wheelhouse-cloud-settings.v1',
				enabled: true,
				gateway: d.gateway,
				device: d
			})
		);
		const v = await s.view();
		expect(v).toMatchObject({ enabled: true, started: false, state: 'off' });
		expect(v.device?.id).toBe('d-1');
	});

	it('reads a file another program wrote as the defaults, with why', async () => {
		await writeFile(path.join(dir, 'settings.json'), '{"enabled": true}');
		const r = await new CloudSettings(dir).read();
		expect(r.settings.enabled).toBe(false);
		expect(r.error).toMatch(/not a Wheelhouse Cloud settings file/);
	});

	it('keeps the key in the Keychain when it can, and in a 0600 file when it cannot', async () => {
		const kept = new Map<string, string>();
		const keychain: Keychain = {
			where: 'the test Keychain',
			get: async (a) => kept.get(a) ?? null,
			set: async (a, v) => void kept.set(a, v),
			remove: async (a) => kept.delete(a)
		};
		const key = newDeviceKey();
		const s = new CloudSettings(dir, keychain);
		expect(await s.setKey(key)).toBe('the test Keychain');
		expect([...kept.values()]).toEqual([exportKey(key)]);
		expect((await s.findKey())?.key.publicKey).toBe(key.publicKey);
		await s.forget();
		expect(kept.size).toBe(0);

		const broken: Keychain = { ...keychain, set: async () => Promise.reject(new Error('locked')) };
		const f = new CloudSettings(dir, broken);
		expect(await f.setKey(key)).toBe(f.keyFile);
		expect((await f.findKey())?.where).toBe(f.keyFile);
	});

	it('says not running when paired and started but no connector is alive', async () => {
		const s = new CloudSettings(dir);
		const d = device();
		await s.setKey(newDeviceKey());
		await s.update((x) => {
			x.enabled = true;
			x.started = true;
			x.device = d;
		});
		expect((await s.view()).state).toBe('not-running');
		// A status left by a process that is gone does not count.
		await s.writeStatus({
			pid: 2 ** 22 + 12345,
			state: 'online',
			reason: null,
			gateway: d.gateway,
			deviceId: d.id,
			since: '2026-11-10T00:00:00.000Z',
			lastSeen: '2026-11-10T00:01:00.000Z',
			updatedAt: '',
			sessions: []
		});
		const v = await s.view();
		expect(v.state).toBe('not-running');
		expect(v.since).toBeNull();
		expect(v.lastSeen).toBe('2026-11-10T00:01:00.000Z');
		// One by this live process does.
		await s.writeStatus({ ...(await s.readStatus())!, pid: process.pid });
		expect((await s.view()).state).toBe('online');
	});

	it('says the key is missing when the record outlived it', async () => {
		const s = new CloudSettings(dir);
		await s.update((x) => {
			x.enabled = true;
			x.device = device();
		});
		const v = await s.view();
		expect(v.state).toBe('not-paired');
		expect(v.reason).toMatch(/device key is missing/);
	});
});
