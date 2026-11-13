import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeGateway } from '../../../../tests/helpers/fake-cloud-gateway';
import { DEFAULT_GATEWAY, type CloudView } from '$lib/cloud';
import { newDeviceKey } from '$lib/server/cloud/protocol';
import { CloudSettings } from '$lib/server/cloud/settings';
import { remoteStarter } from '$lib/server/cloud/starter';

/**
 * GET and POST /api/cloud, as the Remotes page calls them, on a temporary
 * config directory (no Keychain) and a gateway on loopback. Origin and the
 * session token are hooks.server.ts's, tested with it.
 */

let dir: string;
let settings: CloudSettings;
let gw: FakeGateway;

vi.mock('$lib/server/cloud/local', () => ({
	cloudKeychain: () => null,
	cloudSettings: () => settings
}));

const { GET, POST } = await import('./+server');
const { remotesPage } = await import('$lib/server/cloud/page');

const ORIGIN = 'http://127.0.0.1:4310';
type Event = Parameters<typeof POST>[0];

function get(headers: Record<string, string> = {}) {
	const request = new Request(`${ORIGIN}/api/cloud`, { headers });
	return GET({ request } as unknown as Event) as Promise<Response>;
}
function post(body: object, headers: Record<string, string> = {}) {
	const request = new Request(`${ORIGIN}/api/cloud`, {
		method: 'POST',
		headers: { 'content-type': 'application/json', ...headers },
		body: JSON.stringify(body)
	});
	return POST({ request } as unknown as Event) as Promise<Response>;
}
const viewOf = async (r: Response) => ((await r.json()) as { view: CloudView }).view;

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
			pinnedAt: null
		};
	});
}

beforeEach(async () => {
	dir = mkdtempSync(path.join(tmpdir(), 'wh-cloud-route-'));
	settings = new CloudSettings(path.join(dir, 'cloud'));
	gw = await FakeGateway.start();
});
afterEach(async () => {
	await remoteStarter().stop();
	await gw.stop();
	rmSync(dir, { recursive: true, force: true });
});

describe('/api/cloud', () => {
	it('answers only on this machine: never a request that came through the cloud', async () => {
		await settings.update((s) => (s.gateway = gw.origin));
		await post({ action: 'start' });
		const code = (await gw.pending()).code;
		const relayed = { 'x-wheelhouse-remote': '1' };
		const g = await get(relayed);
		expect(g.status).toBe(403);
		const text = await g.text();
		expect(text).toMatch(/only on this machine/);
		expect(text).not.toContain(code);
		for (const body of [
			{ action: 'gateway', gateway: 'https://evil.example' },
			{ action: 'start' },
			{ action: 'stop' },
			{ action: 'disconnect' }
		]) {
			const r = await post(body, relayed);
			expect(r.status).toBe(403);
		}
		expect((await settings.read()).settings.gateway).toBe(gw.origin);
		// The pairing in flight is untouched.
		expect((await (await get()).json()).pairing.userCode).toBe(code);
	});

	it('refuses the Remotes page and Settings → Cloud to a page that came through the cloud', async () => {
		const relayed = new Request(`${ORIGIN}/remotes`, { headers: { 'x-wheelhouse-remote': '1' } });
		await expect(remotesPage(relayed)).rejects.toMatchObject({ status: 403 });
		const local = await remotesPage(new Request(`${ORIGIN}/remotes`));
		expect(local.view.state).toBe('off');
	});

	it('is off and on the default gateway until the captain starts it', async () => {
		const v = (await (await get()).json()) as CloudView;
		expect(v).toMatchObject({
			state: 'off',
			started: false,
			gateway: DEFAULT_GATEWAY,
			pairing: null
		});
	});

	it('starts and stops a paired machine', async () => {
		await paired();
		let v = await viewOf(await post({ action: 'start' }));
		expect(v).toMatchObject({ enabled: true, started: true, state: 'not-running' });
		v = await viewOf(await post({ action: 'stop' }));
		expect(v).toMatchObject({ enabled: false, started: false, state: 'off' });
		expect(v.device?.id).toBe('d-1');
	});

	it('pairs first when Start finds no machine paired', async () => {
		await settings.update((s) => (s.gateway = gw.origin));
		const v = await viewOf(await post({ action: 'start' }));
		const p = await gw.pending();
		expect(v.pairing).toMatchObject({ userCode: p.code, verificationUri: `${gw.origin}/pair` });
		gw.approve(p.code);
		for (let i = 0; i < 300 && !(await settings.read()).settings.device; i++)
			await new Promise((r) => setTimeout(r, 10));
		expect((await (await get()).json()) as CloudView).toMatchObject({
			started: true,
			pairing: null,
			device: { name: expect.any(String) }
		});
	});

	it('says when Start cannot reach the gateway', async () => {
		await settings.update((s) => (s.gateway = 'http://127.0.0.1:9'));
		const r = await post({ action: 'start' });
		expect(r.status).toBe(502);
		expect(((await r.json()) as { message: string }).message).toMatch(/could not be reached/);
	});

	it('takes a gateway: https (or one on this computer), empty for the default', async () => {
		let v = await viewOf(await post({ action: 'gateway', gateway: 'https://gw.example.org/' }));
		expect(v.gateway).toBe('https://gw.example.org');
		for (const bad of ['http://gw.example.org', 'https://gw.example.org/pair', 'nope', 42]) {
			const r = await post({ action: 'gateway', gateway: bad });
			expect(r.status).toBe(400);
		}
		expect((await settings.read()).settings.gateway).toBe('https://gw.example.org');
		v = await viewOf(await post({ action: 'gateway', gateway: '' }));
		expect(v.gateway).toBe(DEFAULT_GATEWAY);
	});

	it('keeps the gateway while a machine is paired or pairing', async () => {
		await settings.update((s) => (s.gateway = gw.origin));
		await post({ action: 'start' });
		await gw.pending();
		let r = await post({ action: 'gateway', gateway: 'https://gw.example.org' });
		expect(r.status).toBe(409);
		await post({ action: 'stop' });
		await paired();
		r = await post({ action: 'gateway', gateway: 'https://gw.example.org' });
		expect(r.status).toBe(409);
		expect((await settings.read()).settings.gateway).toBe(gw.origin);
	});

	it('revokes the machine on its gateway and deletes its key', async () => {
		await paired();
		await post({ action: 'start' });
		const v = await viewOf(await post({ action: 'disconnect' }));
		expect(gw.unpaired).toEqual(['d-1']);
		expect(v).toMatchObject({ device: null, enabled: false, started: false });
		expect(await settings.findKey()).toBeNull();
	});

	it('refuses an unknown action', async () => {
		const r = await post({ action: 'on' });
		expect(r.status).toBe(400);
	});
});
