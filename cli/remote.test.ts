import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeGateway, fingerprintOf, SoftPasskey } from '../tests/helpers/fake-cloud-gateway';
import { DEFAULT_GATEWAY } from '../src/lib/cloud';
import { cloudDir, CloudSettings } from '../src/lib/server/cloud/settings';
import { remoteCommand, type RemoteCliDeps } from './remote';

/** `wheelhouse remote` against a temporary config directory and a gateway on loopback. */

let dir: string;
let out: string[];
let settings: CloudSettings;
let gw: FakeGateway;

beforeEach(async () => {
	dir = mkdtempSync(path.join(tmpdir(), 'wh-remote-cli-'));
	out = [];
	settings = new CloudSettings(cloudDir(path.join(dir, 'config')));
	gw = await FakeGateway.start();
});
afterEach(async () => {
	await gw.stop();
	rmSync(dir, { recursive: true, force: true });
	process.exitCode = undefined;
});

async function run(args: string[], over: Partial<RemoteCliDeps> = {}) {
	const cmd = remoteCommand({
		env: { HOME: dir },
		keychain: null,
		machineName: () => 'Test Mac',
		wheelhouseUp: async () => true,
		waitForStop: async () => {},
		log: (l) => out.push(l),
		error: (l) => out.push(l),
		...over
	});
	cmd
		.exitOverride()
		.configureOutput({ writeErr: (s) => out.push(s), writeOut: (s) => out.push(s) });
	for (const c of cmd.commands) {
		c.exitOverride().configureOutput({
			writeErr: (s) => out.push(s),
			writeOut: (s) => out.push(s)
		});
	}
	await cmd.parseAsync(['--config-dir', path.join(dir, 'config'), ...args], { from: 'user' });
}

/** Run `connect`, and approve the code it shows as the captain would, on the gateway. */
async function connect(extra: string[] = []) {
	const running = run(['connect', '--gateway', gw.origin, ...extra]);
	const p = await gw.pending();
	// The gateway has the pairing a moment before the terminal shows its code.
	while (!out.join('\n').includes('Waiting for approval'))
		await new Promise((r) => setTimeout(r, 5));
	const shown = out.join('\n');
	gw.approve(p.code);
	await running;
	return { pairing: p, shown };
}

describe('wheelhouse remote connect', () => {
	it('shows the code, the fingerprint and a warning, then keeps the key here for the captain only', async () => {
		const { pairing, shown } = await connect();
		expect(shown).toContain(`${gw.origin}/pair`);
		expect(shown).toContain(pairing.code);
		expect(shown).toContain(fingerprintOf(pairing.publicKey));
		expect(shown).toMatch(/Warning: whoever approves this code can use this machine/);
		// The code is typed by the captain: no link carries it.
		expect(shown).not.toContain(`code=${pairing.code}`);
		expect(pairing.name).toBe('Test Mac');

		const { settings: s } = await settings.read();
		expect(s.enabled).toBe(true);
		expect(s.started).toBe(false);
		expect(s.gateway).toBe(gw.origin);
		expect(s.device).toMatchObject({ name: 'Test Mac', gateway: gw.origin, user: 'Captain' });
		expect((await settings.findKey())?.key.publicKey).toBe(pairing.publicKey);
		expect(statSync(settings.keyFile).mode & 0o777).toBe(0o600);
		expect(out.join('\n')).toMatch(/Connected: Test Mac, approved by Captain/);
		expect(process.exitCode).toBeUndefined();
	});

	it('sends the captain to the gateway’s own pair page, never a link the gateway gives with the code', async () => {
		gw.verificationUri = (code) => `${gw.origin}/pair?code=${code}#approve`;
		const { pairing, shown } = await connect();
		expect(shown).toContain(`sign in at   ${gw.origin}/pair\n`);
		expect(shown).not.toContain('?code=');
		expect(shown).not.toContain('#approve');
		expect(shown).toContain(pairing.code);
	});

	it('pairs nothing when the gateway reports another fingerprint', async () => {
		gw.lieAboutFingerprint = true;
		await run(['connect', '--gateway', gw.origin]);
		expect(out.join('\n')).toMatch(
			/reports this machine’s key as AAAA-AAAA-AAAA-AAAA.*do not use this gateway/
		);
		expect(process.exitCode).toBe(1);
		expect((await settings.read()).settings.device).toBeNull();
		expect(await settings.findKey()).toBeNull();
	});

	it('pairs with the default gateway unless told another, and only an https one (or one on this computer)', async () => {
		const asked: string[] = [];
		const offline = (async (url: string) => {
			asked.push(url);
			throw new Error('offline');
		}) as unknown as typeof fetch;
		await run(['connect'], { pairing: { fetch: offline } });
		expect(asked).toEqual([`${DEFAULT_GATEWAY}/v1/pair/start`]);
		expect(out.join('\n')).toMatch(/could not be reached/);
		out = [];
		await run(['connect', '--gateway', 'http://cloud.example.com']);
		expect(out.join('\n')).toMatch(/must be an https:\/\/ URL/);
		expect(gw.pairings.size).toBe(0);
	});

	it('pins the approver’s passkeys once the approval’s signature checks out, and shows their fingerprints', async () => {
		const phone = new SoftPasskey('iPhone');
		gw.passkeys.push(phone);
		const { pairing } = await connect();
		// The machine sent a fresh challenge for the approval to sign.
		expect(Buffer.from(pairing.pinChallenge!, 'base64url').toString('latin1')).toMatch(
			/^whc-pair-v2\n[\s\S]{32}$/
		);
		expect((await settings.read()).settings.device?.pins).toEqual([gw.passkeys[0].pin, phone.pin]);
		const text = out.join('\n');
		expect(text).toMatch(/checks each session itself/);
		expect(text).toContain(`${fingerprintOf(gw.passkeys[0].publicKey)}  MacBook Touch ID`);
		expect(text).toContain(`${fingerprintOf(phone.publicKey)}  iPhone`);
	});

	it('pairs nothing when the approval’s passkey signature does not check out, and tells the gateway to forget it', async () => {
		const mallory = new SoftPasskey('Mallory');
		gw.approvalSignature = (challenge) => mallory.sign(challenge, gw.origin);
		const running = run(['connect', '--gateway', gw.origin]);
		const p = await gw.pending();
		while (!out.join('\n').includes('Waiting for approval'))
			await new Promise((r) => setTimeout(r, 5));
		const deviceId = gw.approve(p.code);
		await running;
		expect(out.join('\n')).toMatch(
			/passkey signature did not check out on this machine \(signed with a passkey this machine does not trust\).*Nothing was paired/
		);
		expect(process.exitCode).toBe(1);
		expect(gw.unpaired).toEqual([deviceId]);
		expect((await settings.read()).settings.device).toBeNull();
		expect(await settings.findKey()).toBeNull();
	});

	it('pairs without pins through a gateway that speaks only protocol 1, and says it does not check sessions', async () => {
		gw.protocol = 1;
		const { pairing } = await connect();
		expect(pairing.pinChallenge).toBeNull();
		expect((await settings.read()).settings.device).toMatchObject({ name: 'Test Mac', pins: null });
		expect(out.join('\n')).toMatch(/does not check sessions itself/);
		expect(process.exitCode).toBeUndefined();
	});

	it('refuses to pair twice', async () => {
		await connect();
		out = [];
		await run(['connect', '--gateway', gw.origin]);
		expect(out.join('\n')).toMatch(/already connected/);
		expect(gw.pairings.size).toBe(1);
	});
});

describe('wheelhouse remote pins', () => {
	const REF = 'a1b2c3d4-0000-4000-8000-000000000001';

	/** Paired with pins, and a change of them the gateway asked for, waiting here. */
	async function waiting() {
		const phone = new SoftPasskey('iPhone');
		await connect();
		await settings.update((s) => {
			s.device!.pending = {
				id: 'a1b2c3d4e5f60718',
				ref: REF,
				passkeys: [phone.pin],
				signedBy: 'MacBook Touch ID',
				requestedAt: new Date().toISOString()
			};
		});
		out = [];
		return phone;
	}

	it('shows the change waiting, what it adds and removes, and how to decide', async () => {
		const phone = await waiting();
		await run(['status']);
		const status = out.join('\n');
		expect(status).toMatch(/Pending:\s+the gateway asked, .*, signed with MacBook Touch ID/);
		expect(status).toContain(`${fingerprintOf(phone.publicKey)}  iPhone  (new)`);
		expect(status).toMatch(/and to stop trusting:\n\s+\S+ {2}MacBook Touch ID/);
		expect(status).toContain('wheelhouse remote pins approve a1b2c3d4');
		out = [];
		await run(['pins']);
		expect(out.join('\n')).toContain(`${fingerprintOf(phone.publicKey)}  iPhone  (new)`);
	});

	it('approves the change waiting: this machine trusts its passkeys from then on', async () => {
		const phone = await waiting();
		await run(['pins', 'approve', 'a1b2c3d4']);
		expect(out.join('\n')).toMatch(/Approved: this machine now trusts only these passkeys/);
		expect(process.exitCode).toBeUndefined();
		expect((await settings.read()).settings.device).toMatchObject({
			pins: [phone.pin],
			pending: null,
			decided: { ref: REF, approved: true }
		});
	});

	it('rejects it: the passkeys trusted stay as they are', async () => {
		await waiting();
		const before = (await settings.read()).settings.device!.pins;
		await run(['pins', 'reject']);
		expect(out.join('\n')).toMatch(/Rejected/);
		expect((await settings.read()).settings.device).toMatchObject({
			pins: before,
			pending: null,
			decided: { ref: REF, approved: false, reason: 'rejected' }
		});
	});

	it('changes nothing for another change’s id, or when none waits', async () => {
		await waiting();
		await run(['pins', 'approve', 'ffffffff']);
		expect(out.join('\n')).toMatch(/the change waiting is a1b2c3d4, not ffffffff/);
		expect(process.exitCode).toBe(1);
		expect((await settings.read()).settings.device?.pending?.ref).toBe(REF);
		await run(['pins', 'reject']);
		out = [];
		await run(['pins', 'approve']);
		expect(out.join('\n')).toMatch(/no change of trusted passkeys is waiting/);
	});
});

describe('wheelhouse remote status, off, on and disconnect', () => {
	it('says it is not paired before connect', async () => {
		await run(['status']);
		expect(out.join('\n')).toMatch(/Turned:\s+off/);
		expect(out.join('\n')).toMatch(/not paired/);
	});

	it('shows the machine and its fingerprint once paired', async () => {
		const { pairing } = await connect();
		out = [];
		await run(['status']);
		const text = out.join('\n');
		expect(text).toContain(`Test Mac (fingerprint ${fingerprintOf(pairing.publicKey)})`);
		expect(text).toMatch(/Sessions:\s+only a session one of these signs is served/);
		expect(text).toContain(`${fingerprintOf(gw.passkeys[0].publicKey)}  MacBook Touch ID`);
		// Pairing never starts it: that is Start on the Remotes page (or `remote run`).
		expect(text).toMatch(/Started:\s+no/);
		expect(text).toMatch(/Connection: off \(not started\)/);
	});

	it('says a machine paired without passkeys does not check sessions', async () => {
		gw.protocol = 1;
		await connect();
		out = [];
		await run(['status']);
		expect(out.join('\n')).toMatch(/Sessions:\s+not checked here: this machine was paired without/);
	});

	it('turns off and on without forgetting the pairing', async () => {
		await connect();
		await run(['off']);
		expect((await settings.read()).settings).toMatchObject({
			enabled: false,
			device: { name: 'Test Mac' }
		});
		await run(['on']);
		expect((await settings.read()).settings.enabled).toBe(true);
	});

	it('revokes the machine on the gateway and deletes its key here', async () => {
		await connect();
		const deviceId = (await settings.read()).settings.device!.id;
		out = [];
		await run(['disconnect']);
		expect(gw.unpaired).toEqual([deviceId]);
		expect(out.join('\n')).toMatch(/Disconnected Test Mac: the gateway revoked it/);
		expect(await settings.findKey()).toBeNull();
		expect((await settings.read()).settings).toMatchObject({ enabled: false, device: null });
	});

	it('deletes the key even when the gateway cannot be reached, and says so', async () => {
		await connect();
		await gw.stop();
		out = [];
		await run(['disconnect']);
		expect(out.join('\n')).toMatch(/could not be told/);
		expect(await settings.findKey()).toBeNull();
		gw = await FakeGateway.start();
	});
});

describe('wheelhouse remote run', () => {
	it('pairs with the default gateway when the machine is not paired and none is named', async () => {
		const asked: string[] = [];
		const offline = (async (url: string) => {
			asked.push(url);
			throw new Error('offline');
		}) as unknown as typeof fetch;
		await run(['run'], { pairing: { fetch: offline } });
		expect(asked).toEqual([`${DEFAULT_GATEWAY}/v1/pair/start`]);
	});

	it('pairs headless first, in one log line, then connects', async () => {
		const socket = gw.nextSocket();
		let stop: () => void = () => {};
		const running = run(['run', '--gateway', gw.origin, '--port', '4999'], {
			waitForStop: () => new Promise<void>((r) => (stop = r))
		});
		const p = await gw.pending();
		while (!out.some((l) => l.includes(p.code))) await new Promise((r) => setTimeout(r, 5));
		const line = out.find((l) => l.includes(p.code))!;
		expect(line).toContain(`sign in at ${gw.origin}/pair`);
		expect(line).toContain(`pick the fingerprint ${fingerprintOf(p.publicKey)}`);
		expect(line).toContain('Warning: whoever approves this code');
		const deviceId = gw.approve(p.code);
		const s = await socket;
		expect(s.deviceId).toBe(deviceId);
		stop();
		await running;
		expect((await settings.read()).settings.enabled).toBe(true);
	});

	it('starts a new pairing when a code expires', async () => {
		let stop: () => void = () => {};
		const running = run(['run', '--gateway', gw.origin], {
			pairing: { sleep: (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 10))) },
			waitForStop: () => new Promise<void>((r) => (stop = r))
		});
		const first = await gw.pending();
		gw.expire(first.code);
		const second = await gw.pending();
		expect(second.code).not.toBe(first.code);
		expect(second.publicKey).not.toBe(first.publicKey);
		expect(out.join('\n')).toMatch(/A new code follows/);
		stop();
		await running;
		expect((await settings.read()).settings.device).toBeNull();
	});

	it('stops when the pairing is denied', async () => {
		const running = run(['run', '--gateway', gw.origin], {
			waitForStop: () => new Promise<void>(() => {})
		});
		const p = await gw.pending();
		p.status = 'denied';
		await running;
		expect(out.join('\n')).toMatch(/denied/);
		expect(process.exitCode).toBe(1);
	});

	it('reconnects after the gateway drops the connection', async () => {
		await connect();
		const first = gw.nextSocket();
		let stop: () => void = () => {};
		const running = run(['run', '--port', '4999'], {
			waitForStop: () => new Promise<void>((r) => (stop = r))
		});
		const s = await first;
		const second = gw.nextSocket();
		s.ws_.terminate();
		expect((await second).deviceId).toBe(s.deviceId);
		stop();
		await running;
	});

	it('connects and relays until stopped', async () => {
		await connect();
		const socket = gw.nextSocket();
		let stop: () => void = () => {};
		const running = run(['run', '--port', '4999'], {
			waitForStop: () => new Promise<void>((r) => (stop = r))
		});
		const s = await socket;
		expect(s.deviceId).toBe((await settings.read()).settings.device!.id);
		stop();
		await running;
		expect(out.join('\n')).toMatch(/Relaying to http:\/\/127\.0\.0\.1:4999\//);
	});
});
