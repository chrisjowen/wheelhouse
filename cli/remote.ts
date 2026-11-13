import path from 'node:path';
import { Command, InvalidArgumentError } from 'commander';
import { version } from '../package.json';
import { DEFAULT_GATEWAY, type CloudPasskeyView } from '../src/lib/cloud';
import { resolveInstall } from '../src/lib/server/firstmate/install';
import type { Keychain } from '../src/lib/server/gateway/keychain';
import { cloudKeychain } from '../src/lib/server/cloud/local';
import {
	disconnect,
	keepDevice,
	machineName,
	pollPairing,
	startPairing,
	type Approved,
	type PairingDeps
} from '../src/lib/server/cloud/pairing';
import { passkeyFingerprint } from '../src/lib/server/cloud/passkeys';
import { fingerprint, newDeviceKey, type DeviceKey } from '../src/lib/server/cloud/protocol';
import { CloudService } from '../src/lib/server/cloud/service';
import { cloudDir, CloudSettings, gatewayOrigin } from '../src/lib/server/cloud/settings';
import { defaultConfigDir } from '../src/lib/server/plugins/config';
import { isInside } from '../src/lib/server/store/store';

/**
 * `wheelhouse remote …`: reach this machine's Wheelhouse from anywhere through
 * a Wheelhouse Cloud gateway, which relays the browser to it; Firstmate and
 * its crew keep running here. `connect` pairs the machine: it shows a short
 * code and the fingerprint of a key made here, the captain types the code on
 * the gateway and checks the fingerprint matches, and the key stays on this
 * machine (the Keychain, else a file only the captain can read). A running
 * `wheelhouse open` keeps the connection up once the captain starts it on the
 * Remotes page (never by itself); `run` does it now, without that (for a
 * machine where Wheelhouse runs under another supervisor).
 * `status` says where things stand, the passkeys the machine trusts to sign
 * its sessions among it, and `disconnect` revokes the machine.
 */

export interface RemoteCliDeps {
	env: NodeJS.ProcessEnv;
	keychain: Keychain | null;
	pairing: PairingDeps;
	/** The suggested machine name. */
	machineName: () => string;
	/** Whether a Wheelhouse answers on this port. */
	wheelhouseUp: (port: number) => Promise<boolean>;
	/** Runs until the returned promise settles (Ctrl+C); for tests, a stand-in. */
	waitForStop: () => Promise<void>;
	log: (line: string) => void;
	error: (line: string) => void;
}

function parsePort(value: string): number {
	const n = Number(value);
	if (!Number.isInteger(n) || n < 1 || n > 65535) {
		throw new InvalidArgumentError('Port must be a whole number from 1 to 65535.');
	}
	return n;
}

/** Said with every code: approving it hands over this machine. */
const WARNING =
	'Warning: whoever approves this code can use this machine’s Wheelhouse from anywhere, terminals included, so they can run commands here. Type the code yourself, only at the address above, and only approve when the fingerprint matches. If someone sent you this command or asked you for the code, stop now (Ctrl+C).';

export { machineName };

/**
 * The ports the Wheelhouse on `appPort` reports as previews, asked at most
 * every couple of seconds; none when it does not answer.
 */
export function localPreviewPorts(appPort: () => number, ttlMs = 2000): () => Promise<Set<number>> {
	let cached: { at: number; ports: Promise<Set<number>> } | null = null;
	return () => {
		if (cached && Date.now() - cached.at < ttlMs) return cached.ports;
		const ports = (async () => {
			try {
				const r = await fetch(`http://127.0.0.1:${appPort()}/api/cloud/previews`, {
					signal: AbortSignal.timeout(1500)
				});
				const body = (await r.json()) as { ports?: unknown };
				return new Set(
					Array.isArray(body.ports)
						? body.ports.filter((p): p is number => Number.isInteger(p))
						: []
				);
			} catch {
				return new Set<number>();
			}
		})();
		cached = { at: Date.now(), ports };
		return ports;
	};
}

async function wheelhouseUp(port: number): Promise<boolean> {
	try {
		const r = await fetch(`http://127.0.0.1:${port}/api/health`, {
			signal: AbortSignal.timeout(1500)
		});
		return r.ok;
	} catch {
		return false;
	}
}

function waitForSignal(): Promise<void> {
	return new Promise((resolve) => {
		process.once('SIGINT', () => resolve());
		process.once('SIGTERM', () => resolve());
	});
}

/**
 * The passkeys this machine trusts to sign its sessions, a line each with the
 * fingerprint the gateway's Account page shows too; or why it checks none.
 */
function trusted(passkeys: CloudPasskeyView[] | null): string[] {
	if (passkeys === null) {
		return [
			'not checked here: this machine was paired without passkeys, so it serves any session the gateway opens. Revoke it and pair it again to have it check each one.'
		];
	}
	if (!passkeys.length) {
		return [
			'could not be read, so this machine refuses every session. Revoke it and pair it again.'
		];
	}
	return [
		'only a session one of these signs is served:',
		...passkeys.map((p) => `  ${p.fingerprint}  ${p.name || '(unnamed)'}`)
	];
}

const ago = (iso: string | null) => {
	if (!iso) return 'never';
	const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
	return s < 90
		? `${s} s ago`
		: s < 5400
			? `${Math.round(s / 60)} min ago`
			: new Date(iso).toLocaleString();
};

export function remoteCommand(over: Partial<RemoteCliDeps> = {}): Command {
	const deps: RemoteCliDeps = {
		env: process.env,
		keychain: cloudKeychain(),
		pairing: {},
		machineName,
		wheelhouseUp,
		waitForStop: waitForSignal,
		log: (line) => console.log(line),
		error: (line) => console.error(line),
		...over
	};
	const cmd = new Command('remote')
		.description(
			'Reach this Wheelhouse from anywhere through a Wheelhouse Cloud gateway (off until you start it on the Remotes page, or `remote run`).'
		)
		.option(
			'--config-dir <dir>',
			'the Wheelhouse config directory (default: $WHEELHOUSE_CONFIG_DIR, else $XDG_CONFIG_HOME/wheelhouse, else ~/.config/wheelhouse)'
		);

	const fail = (line: string) => {
		deps.error(`wheelhouse: ${line}`);
		process.exitCode = 1;
	};

	/** The settings, or null (with why) when the config directory sits in the Firstmate home. */
	const settingsFor = (c: Command): CloudSettings | null => {
		const dir = c.optsWithGlobals().configDir as string | undefined;
		const configDir = dir ? path.resolve(dir) : defaultConfigDir(deps.env);
		const found = resolveInstall({ cwd: process.cwd(), env: deps.env });
		if (found.ok && isInside(configDir, found.install.homeDir)) {
			fail(
				`the config directory ${configDir} is inside the Firstmate home, where the crew can read it. Pass --config-dir <dir> outside it.`
			);
			return null;
		}
		return new CloudSettings(cloudDir(configDir), deps.keychain);
	};

	/** The gateway to pair with, from --gateway or the settings (the default unless one was named), saved for next time. */
	const gatewayFor = async (settings: CloudSettings, given?: string): Promise<string | null> => {
		const raw = given ?? (await settings.read()).settings.gateway;
		const origin = gatewayOrigin(raw);
		if (!origin.ok) {
			fail(origin.error);
			return null;
		}
		await settings.update((x) => (x.gateway = origin.origin));
		return origin.origin;
	};

	const machine = (name?: string) => ({
		name: (name ?? deps.machineName()).trim().slice(0, 60) || 'Wheelhouse',
		platform: `${process.platform}-${process.arch}`,
		version
	});

	/** Keep the approved device: its key here, its record in the settings, and the cloud on. */
	const keep = async (
		settings: CloudSettings,
		gateway: string,
		key: DeviceKey,
		name: string,
		device: Approved
	) => {
		const where = await keepDevice(settings, gateway, key, name, device);
		deps.log(
			`Connected: ${device.name || name}${device.user ? `, approved by ${device.user}` : ''}.`
		);
		deps.log(`Its key is kept in ${where}, readable by you only; it never leaves this machine.`);
		if (device.pins) {
			deps.log(
				'It checks each session itself: only a session one of these passkeys signs is served (your gateway’s Account page shows the same fingerprints):'
			);
			for (const p of device.pins) deps.log(`  ${passkeyFingerprint(p)}  ${p.name || '(unnamed)'}`);
		} else {
			deps.log(
				'Warning: the gateway pinned none of your passkeys (it speaks only protocol 1), so this machine does not check sessions itself: it serves any session the gateway opens. Pair it again once the gateway is updated.'
			);
		}
	};

	cmd
		.command('connect')
		.description(
			'Pair this machine with a gateway: shows a code to type there and a fingerprint to check.'
		)
		.option(
			'--gateway <url>',
			`the gateway, such as https://cloud.example.com (remembered; default ${DEFAULT_GATEWAY})`
		)
		.option('--name <name>', 'the name this machine gets there (default: its host name)')
		.action(async (o: { gateway?: string; name?: string }, c: Command) => {
			const settings = settingsFor(c);
			if (!settings) return;
			const { settings: s } = await settings.read();
			if (s.device && (await settings.findKey())) {
				return fail(
					`this machine is already connected to ${s.device.gateway} as ${s.device.name}. Run \`wheelhouse remote disconnect\` first.`
				);
			}
			const gateway = await gatewayFor(settings, o.gateway);
			if (!gateway) return;
			const key = newDeviceKey();
			const m = machine(o.name);
			const name = m.name;
			const started = await startPairing(gateway, key, m, deps.pairing);
			if (!started.ok) return fail(started.error);
			const p = started.start;
			const mins = Math.round(p.expiresIn / 60);
			deps.log(`Pairing this machine (${name}) with Wheelhouse Cloud at ${gateway}.`);
			deps.log('');
			deps.log(`  1. On a device you trust, sign in at   ${p.verificationUri}`);
			deps.log(`  2. Type this code there:                ${p.userCode}`);
			deps.log(`  3. Pick this machine’s fingerprint:     ${fingerprint(key.publicKey)}`);
			deps.log('');
			deps.log(WARNING);
			deps.log('');
			deps.log(`Waiting for approval (the code works for ${mins} minutes)…`);
			const outcome = await pollPairing(gateway, key, p, deps.pairing);
			if (outcome.status !== 'approved') return fail(`${outcome.reason} Nothing was paired.`);
			await keep(settings, gateway, key, name, outcome.device);
			deps.log(
				'Start it on the Remotes page in Wheelhouse, which keeps the connection up while `wheelhouse open` runs; or run `wheelhouse remote run`.'
			);
		});

	cmd
		.command('status')
		.description(
			'Show whether this machine is connected, since when, the passkeys it trusts to sign its sessions, and its relay sessions.'
		)
		.action(async (_o: unknown, c: Command) => {
			const settings = settingsFor(c);
			if (!settings) return;
			const v = await settings.view();
			deps.log('Wheelhouse Cloud');
			deps.log(`  Turned:     ${v.enabled ? 'on' : 'off'}`);
			deps.log(
				`  Started:    ${v.started ? 'yes, on the Remotes page' : 'no (Start on the Remotes page in Wheelhouse, or wheelhouse remote run)'}`
			);
			deps.log(`  Gateway:    ${v.gateway}`);
			deps.log(
				`  Machine:    ${v.device ? `${v.device.name} (fingerprint ${v.device.fingerprint})${v.device.user ? `, approved by ${v.device.user}` : ''}` : 'not paired (wheelhouse remote connect)'}`
			);
			if (v.keyStore) deps.log(`  Key:        ${v.keyStore}`);
			if (v.device) {
				const [first, ...rest] = trusted(v.device.passkeys);
				deps.log(`  Sessions:   ${first}`);
				for (const line of rest) deps.log(`              ${line}`);
			}
			const states: Record<typeof v.state, string> = {
				off: 'off (not started)',
				'not-paired': 'not paired',
				'not-running': 'not running (start Wheelhouse, or wheelhouse remote run)',
				connecting: 'connecting',
				online: `online since ${v.since ? new Date(v.since).toLocaleString() : '?'}`,
				stopped: 'stopped'
			};
			deps.log(`  Connection: ${states[v.state]}${v.reason ? ` (${v.reason})` : ''}`);
			if (v.device) deps.log(`  Last seen:  ${ago(v.lastSeen)}`);
			if (v.sessions.length) {
				deps.log('  Relay sessions:');
				for (const s of v.sessions.slice(0, 10)) {
					deps.log(
						`    ${s.id.slice(0, 8)}  ${s.user}  ${s.requests} request${s.requests === 1 ? '' : 's'}, last ${ago(s.lastAt)}`
					);
				}
			}
		});

	cmd
		.command('disconnect')
		.description('Revoke this machine on its gateway and delete its key here.')
		.action(async (_o: unknown, c: Command) => {
			const settings = settingsFor(c);
			if (!settings) return;
			const r = await disconnect(settings, deps.pairing);
			if (!r.device) return deps.log('This machine was not connected; Wheelhouse Cloud is off.');
			if (r.revoked)
				deps.log(`Disconnected ${r.device}: the gateway revoked it and its key is deleted here.`);
			else {
				deps.log(`Deleted ${r.device}’s key here; Wheelhouse Cloud is off.`);
				deps.log(
					`Warning: the gateway could not be told (${r.error}). Remove the machine from its list of machines too.`
				);
			}
		});

	for (const [name, on] of [
		['on', true],
		['off', false]
	] as const) {
		cmd
			.command(name)
			.description(
				on
					? 'Turn Wheelhouse Cloud back on for this paired machine.'
					: 'Turn Wheelhouse Cloud off: the connection closes and nothing is relayed, but the pairing is kept.'
			)
			.action(async (_o: unknown, c: Command) => {
				const settings = settingsFor(c);
				if (!settings) return;
				const s = await settings.update((x) => (x.enabled = on));
				deps.log(
					on && !s.device
						? 'Wheelhouse Cloud is on, but this machine is not paired: wheelhouse remote connect.'
						: `Wheelhouse Cloud is turned ${name}.`
				);
			});
	}

	cmd
		.command('run')
		.description(
			'Keep the connection up now, without starting it on the Remotes page, relaying to the Wheelhouse on --port; pairs first when this machine is not paired yet.'
		)
		.option('--port <n>', 'the port the local Wheelhouse listens on', parsePort, 4310)
		.option(
			'--gateway <url>',
			`the gateway to pair with, when this machine is not paired yet (default: the one set, else ${DEFAULT_GATEWAY})`
		)
		.option('--name <name>', 'the name this machine gets there (default: its host name)')
		.action(async (o: { port: number; gateway?: string; name?: string }, c: Command) => {
			const settings = settingsFor(c);
			if (!settings) return;
			const alive = setInterval(() => {}, 1 << 30);
			try {
				await relayUntilStopped(settings, o);
			} finally {
				clearInterval(alive);
			}
		});

	async function relayUntilStopped(
		settings: CloudSettings,
		o: { port: number; gateway?: string; name?: string }
	): Promise<void> {
		const stopped = deps.waitForStop().then(() => null);
		let v = await settings.view();
		if (v.device && !v.enabled) return fail('Wheelhouse Cloud is off here: wheelhouse remote on.');
		if (!v.device && !(await pairHeadless(settings, o, stopped))) return;
		v = await settings.view();
		if (!(await deps.wheelhouseUp(o.port))) {
			deps.log(
				`Warning: no Wheelhouse answers on port ${o.port} yet; relayed pages fail until one does.`
			);
		}
		const service = new CloudService({
			settings,
			version,
			// Asked for here, explicitly: no need to start it on the Remotes page too.
			startedOnly: false,
			appPort: () => o.port,
			previewPorts: localPreviewPorts(() => o.port),
			log: (line) => deps.log(line)
		});
		await service.start();
		deps.log(`Relaying to http://127.0.0.1:${o.port}/. Press Ctrl+C to disconnect.`);
		await stopped;
		await service.stop();
	}

	/**
	 * §3.5 of the protocol: pairing with no terminal to talk to. One log line
	 * says where to type which code and which fingerprint to pick; a code that
	 * expires is followed by a new one, after a pause that grows. True once
	 * paired; false when it was denied, could not start, or the run was stopped.
	 */
	async function pairHeadless(
		settings: CloudSettings,
		o: { gateway?: string; name?: string },
		stopped: Promise<null>
	): Promise<boolean> {
		const gateway = await gatewayFor(settings, o.gateway);
		if (!gateway) return false;
		const m = machine(o.name);
		const sleep = deps.pairing.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
		for (let attempt = 0; ; attempt++) {
			const key = newDeviceKey();
			const started = await Promise.race([startPairing(gateway, key, m, deps.pairing), stopped]);
			if (!started) return false;
			if (!started.ok) {
				fail(started.error);
				return false;
			}
			const p = started.start;
			deps.log(
				`Wheelhouse Cloud: to pair ${m.name}, sign in at ${p.verificationUri}, type the code ${p.userCode} and pick the fingerprint ${fingerprint(key.publicKey)} (within ${Math.round(p.expiresIn / 60)} minutes). ${WARNING}`
			);
			const outcome = await Promise.race([pollPairing(gateway, key, p, deps.pairing), stopped]);
			if (!outcome) return false;
			if (outcome.status === 'approved') {
				await keep(settings, gateway, key, m.name, outcome.device);
				return true;
			}
			if (outcome.status !== 'expired') {
				fail(`${outcome.reason} Nothing was paired.`);
				return false;
			}
			const wait = Math.min(5_000 * 2 ** attempt, 5 * 60_000);
			deps.log(
				`Wheelhouse Cloud: ${outcome.reason} A new code follows in ${Math.round(wait / 1000)} s.`
			);
			if ((await Promise.race([sleep(wait).then(() => true), stopped])) === null) return false;
		}
	}
	return cmd;
}
