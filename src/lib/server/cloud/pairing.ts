import { hostname } from 'node:os';
import { fingerprint, PROTOCOL, pollSig, unpairSig, type DeviceKey } from './protocol';
import type { CloudSettings } from './settings';

/**
 * Pairing a machine with a gateway (§3 of the protocol), like the OAuth
 * device flow: the connector sends its public key, shows the short code and
 * the key's fingerprint, and polls, with signatures, until the captain has
 * typed the code on the gateway and approved; then unpairing, signed too.
 */

export interface PairStart {
	pairingId: string;
	userCode: string;
	verificationUri: string;
	fingerprint: string;
	expiresIn: number;
	interval: number;
}

export interface Approved {
	deviceId: string;
	name: string;
	user: string | null;
}

export type PollOutcome =
	| { status: 'approved'; device: Approved }
	| { status: 'denied' | 'expired'; reason: string }
	| { status: 'failed'; reason: string };

export interface PairingDeps {
	fetch?: typeof fetch;
	sleep?: (ms: number) => Promise<void>;
	now?: () => number;
	/** Polling ends (as failed) once this aborts: the captain cancelled the pairing. */
	signal?: AbortSignal;
}

/** The suggested machine name: the host name without `.local`, at most 60 characters. */
export function machineName(): string {
	return (
		hostname()
			.replace(/\.local$/i, '')
			.slice(0, 60) || 'Wheelhouse'
	);
}

/**
 * Keep an approved device: its key here (the Keychain, else its 0600 file),
 * its record in the settings, and the cloud on; `start` also starts it, as
 * Start on the Remotes page does. Returns where the key went.
 */
export async function keepDevice(
	settings: CloudSettings,
	gateway: string,
	key: DeviceKey,
	name: string,
	device: Approved,
	opts: { start?: boolean } = {}
): Promise<string> {
	const where = await settings.setKey(key);
	await settings.update((x) => {
		x.enabled = true;
		if (opts.start) x.started = true;
		x.gateway = gateway;
		x.device = {
			id: device.deviceId,
			name: device.name || name,
			gateway,
			publicKey: key.publicKey,
			user: device.user,
			pairedAt: new Date().toISOString()
		};
	});
	return where;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

async function body(r: Response): Promise<Obj> {
	const v: unknown = await r.json().catch(() => null);
	return isObj(v) ? v : {};
}

async function post(f: typeof fetch, url: string, payload: unknown): Promise<Response> {
	return f(url, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(payload),
		redirect: 'error',
		signal: AbortSignal.timeout(15_000)
	});
}

const unreachable = (gateway: string, e: unknown) =>
	`The gateway at ${gateway} could not be reached: ${(e as Error).message}`;

/** §3.1: start a pairing; the gateway's fingerprint must match the key's own. */
export async function startPairing(
	gateway: string,
	key: DeviceKey,
	machine: { name: string; platform: string; version: string },
	deps: PairingDeps = {}
): Promise<{ ok: true; start: PairStart } | { ok: false; error: string }> {
	const f = deps.fetch ?? fetch;
	let r: Response;
	try {
		r = await post(f, `${gateway}/v1/pair/start`, {
			protocol: PROTOCOL,
			publicKey: key.publicKey,
			name: machine.name.slice(0, 60) || 'Wheelhouse',
			platform: machine.platform.slice(0, 40),
			agent: { name: 'wheelhouse', version: machine.version.slice(0, 40) }
		});
	} catch (e) {
		return { ok: false, error: unreachable(gateway, e) };
	}
	const b = await body(r);
	if (r.status === 426) {
		return {
			ok: false,
			error:
				'The gateway no longer speaks this Wheelhouse’s protocol. Update Wheelhouse: wheelhouse upgrade.'
		};
	}
	if (r.status === 429) {
		const wait =
			typeof b.retryAfter === 'number' ? ` Try again in ${Math.ceil(b.retryAfter / 60)} min.` : '';
		return { ok: false, error: `The gateway is refusing more pairings for now.${wait}` };
	}
	if (r.status !== 201 && r.status !== 200) {
		const why = typeof b.message === 'string' ? `: ${b.message.slice(0, 200)}` : '';
		return { ok: false, error: `The gateway refused the pairing (${r.status})${why}.` };
	}
	const start: PairStart = {
		pairingId: typeof b.pairingId === 'string' ? b.pairingId : '',
		userCode: typeof b.userCode === 'string' ? b.userCode : '',
		// The page the captain types the code on: the gateway's own, never one it names.
		verificationUri: `${gateway}/pair`,
		fingerprint: typeof b.fingerprint === 'string' ? b.fingerprint : '',
		expiresIn: typeof b.expiresIn === 'number' ? b.expiresIn : 600,
		interval: typeof b.interval === 'number' && b.interval > 0 ? b.interval : 3
	};
	if (
		!start.pairingId ||
		!/^[23456789BCDFGHJKLMNPQRSTVWXZ]{4}-?[23456789BCDFGHJKLMNPQRSTVWXZ]{4}$/i.test(start.userCode)
	) {
		return {
			ok: false,
			error: 'The gateway’s answer is not a pairing this Wheelhouse understands.'
		};
	}
	const own = fingerprint(key.publicKey);
	if (start.fingerprint !== own) {
		return {
			ok: false,
			error: `The gateway reports this machine’s key as ${start.fingerprint || 'nothing'}, not ${own}. Nothing was paired; do not use this gateway.`
		};
	}
	return { ok: true, start };
}

/** §3.2: poll until the pairing is approved, denied or expired. */
export async function pollPairing(
	gateway: string,
	key: DeviceKey,
	start: PairStart,
	deps: PairingDeps = {}
): Promise<PollOutcome> {
	const f = deps.fetch ?? fetch;
	const sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
	const now = deps.now ?? Date.now;
	const until = now() + start.expiresIn * 1000;
	let interval = start.interval;
	let failures = 0;
	const cancelled = { status: 'failed', reason: 'The pairing was cancelled.' } as const;
	while (now() < until) {
		await sleep(interval * 1000);
		if (deps.signal?.aborted) return cancelled;
		let r: Response;
		try {
			r = await post(f, `${gateway}/v1/pair/poll`, {
				pairingId: start.pairingId,
				sig: pollSig(key, start.pairingId)
			});
		} catch (e) {
			if (deps.signal?.aborted) return cancelled;
			// A lost poll is retried: an approval is returned to every poll until the pairing expires.
			if (++failures >= 5) return { status: 'failed', reason: unreachable(gateway, e) };
			continue;
		}
		failures = 0;
		const b = await body(r);
		if (deps.signal?.aborted) return cancelled;
		if (r.status === 429) {
			interval += 5;
			if (typeof b.retryAfter === 'number') await sleep(b.retryAfter * 1000);
			continue;
		}
		if (r.status === 410)
			return { status: 'expired', reason: 'The code expired before it was approved.' };
		if (r.status === 401) {
			return { status: 'failed', reason: 'The gateway no longer knows this pairing.' };
		}
		if (r.status !== 200) {
			if (++failures >= 5) return { status: 'failed', reason: `The gateway answered ${r.status}.` };
			continue;
		}
		if (b.status === 'approved' && typeof b.deviceId === 'string' && b.deviceId) {
			const user = isObj(b.user) && typeof b.user.name === 'string' ? b.user.name : null;
			return {
				status: 'approved',
				device: { deviceId: b.deviceId, name: typeof b.name === 'string' ? b.name : '', user }
			};
		}
		if (b.status === 'denied')
			return { status: 'denied', reason: 'The pairing was denied on the gateway.' };
		if (b.status === 'expired')
			return { status: 'expired', reason: 'The code expired before it was approved.' };
	}
	return { status: 'expired', reason: 'The code expired before it was approved.' };
}

/** §3.4: tell the gateway to forget this device. True when it answered that it did. */
export async function unpair(
	gateway: string,
	key: DeviceKey,
	deviceId: string,
	deps: PairingDeps = {}
): Promise<{ ok: true } | { ok: false; error: string }> {
	const f = deps.fetch ?? fetch;
	const ts = (deps.now ?? Date.now)();
	try {
		const r = await post(f, `${gateway}/v1/device/unpair`, {
			deviceId,
			ts,
			sig: unpairSig(key, deviceId, ts)
		});
		if (r.status === 204 || r.status === 200) return { ok: true };
		return { ok: false, error: `The gateway answered ${r.status}.` };
	} catch (e) {
		return { ok: false, error: unreachable(gateway, e) };
	}
}

/**
 * Disconnect this machine: ask its gateway to revoke it, then delete its key
 * and record here whatever the gateway said, even when it cannot be reached
 * (an unused key does no harm; the machine can also be removed from the
 * gateway's own list). Wheelhouse Cloud is turned off here too.
 */
export async function disconnect(
	settings: CloudSettings,
	deps: PairingDeps = {}
): Promise<{ device: string | null; revoked: boolean; error: string | null }> {
	const { settings: s } = await settings.read();
	const found = s.device ? await settings.findKey() : null;
	const told =
		s.device && found ? await unpair(s.device.gateway, found.key, s.device.id, deps) : null;
	await settings.forget();
	await settings.update((x) => {
		x.enabled = false;
		x.started = false;
	});
	return {
		device: s.device?.name ?? null,
		revoked: told?.ok ?? false,
		error: told && !told.ok ? told.error : null
	};
}
