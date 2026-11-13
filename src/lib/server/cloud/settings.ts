import { createHash, randomBytes } from 'node:crypto';
import {
	chmod,
	lstat,
	mkdir,
	readFile,
	realpath,
	rename,
	rm,
	stat,
	writeFile
} from 'node:fs/promises';
import path from 'node:path';
import {
	DEFAULT_GATEWAY,
	type CloudDeviceView,
	type CloudPendingPinsView,
	type CloudState,
	type CloudView,
	type RelaySession
} from '../../cloud';
import type { Keychain } from '../gateway/keychain';
import { PENDING_PINS_MS, type PinsProposal } from './guard';
import { parsePasskeys, passkeyFingerprint, type PinnedPasskey } from './passkeys';
import { exportKey, fingerprint, importKey, type DeviceKey } from './protocol';

/**
 * Wheelhouse Cloud's settings, in the captain-owned config directory
 * (`<config-dir>/cloud/`, never the Firstmate home): `settings.json` says
 * whether the cloud may be used here at all (`enabled`, off until the captain
 * pairs or starts it), whether the captain started it on the Remotes page
 * (`started`: the only thing that makes `wheelhouse open` connect, and it
 * stays on across restarts until they stop it), which gateway it uses
 * (DEFAULT_GATEWAY unless the captain names another; the file keeps only a
 * gateway they named) and which device this machine is there, with the
 * passkeys it trusts to sign its sessions. The device's private key is kept in the macOS Keychain
 * (service `wheelhouse-cloud`); where that cannot be used, `device.key` holds
 * it, alone, readable by the captain's user only (0600 in a 0700 directory).
 *
 * The connector that holds the gateway socket writes `status.json`: whether
 * it is online, since when, the last time it heard the gateway, and the relay
 * sessions it has seen. `wheelhouse remote status` and Settings → Cloud read it.
 */

export const CLOUD_SETTINGS_SCHEMA = 'wheelhouse-cloud-settings.v1';
export const CLOUD_STATUS_SCHEMA = 'wheelhouse-cloud-status.v1';
export const CLOUD_KEYCHAIN_SERVICE = 'wheelhouse-cloud';

export interface CloudDevice {
	id: string;
	name: string;
	/** The gateway origin it was paired with. */
	gateway: string;
	publicKey: string;
	user: string | null;
	pairedAt: string;
	/**
	 * The passkeys this machine trusts to sign its sessions, pinned at pairing
	 * and changed only by a signed update the captain approved here (§6.6);
	 * null when it was paired without, and empty when they could not be read
	 * (every session refused).
	 */
	pins: PinnedPasskey[] | null;
	pinnedAt: string | null;
	/**
	 * The one pending change of pins: a new list a trusted passkey signed,
	 * waiting for the captain to approve or reject it here. It changes nothing
	 * until then, and lapses after an hour.
	 */
	pending: PendingPins | null;
	/**
	 * The decisions on pending changes not yet handed to the connector, oldest
	 * first, for it to tell the gateway (`pins.decided`), whichever process
	 * made them.
	 */
	undelivered: PinsDecision[];
}

/**
 * A pending change, with the id this machine gave it: approving or rejecting
 * names that id, so a change the gateway sends again under the same ref, with
 * other passkeys, is a new change the captain has not seen.
 */
export type PendingPins = PinsProposal & { id: string; requestedAt: string };

export interface PinsDecision {
	ref: string;
	approved: boolean;
	/** Why it was not approved. */
	reason: 'rejected' | 'expired' | 'replaced' | null;
	at: string;
}

/** A pending change past its hour counts as rejected (expired). */
export const lapsed = (p: PendingPins, now = Date.now()) =>
	!(now - Date.parse(p.requestedAt) <= PENDING_PINS_MS);

export interface CloudSettingsData {
	enabled: boolean;
	/** Started on the Remotes page; `wheelhouse open` connects only while it is (with `enabled`). */
	started: boolean;
	/** The gateway's origin: DEFAULT_GATEWAY unless the captain named another. */
	gateway: string;
	device: CloudDevice | null;
}

/** What the running connector last wrote. */
export interface CloudStatus {
	pid: number;
	state: 'connecting' | 'online' | 'stopped';
	reason: string | null;
	gateway: string;
	deviceId: string;
	since: string | null;
	lastSeen: string | null;
	updatedAt: string;
	sessions: RelaySession[];
}

/** The cloud directory inside a Wheelhouse config directory. */
export const cloudDir = (configDir: string) => path.join(configDir, 'cloud');

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);

/**
 * A gateway address as typed, as the origin it names, or null with why: https,
 * or plain http only to this computer (for testing), with no path, query or
 * credentials.
 */
export function gatewayOrigin(
	raw: string
): { ok: true; origin: string } | { ok: false; error: string } {
	const u = URL.parse(raw.trim());
	if (!u) return { ok: false, error: `${raw.trim() || 'That'} is not a URL.` };
	if (u.username || u.password)
		return { ok: false, error: 'The gateway URL may not carry credentials.' };
	const loopback = LOOPBACK.has(u.hostname.toLowerCase());
	if (u.protocol !== 'https:' && !(u.protocol === 'http:' && loopback)) {
		return { ok: false, error: 'The gateway must be an https:// URL.' };
	}
	if ((u.pathname !== '/' && u.pathname !== '') || u.search || u.hash) {
		return {
			ok: false,
			error: 'Give the gateway as its address only, such as https://cloud.example.com.'
		};
	}
	return { ok: true, origin: u.origin };
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

function parseDevice(v: unknown): CloudDevice | null {
	if (!isObj(v)) return null;
	const id = str(v.id);
	const gateway = str(v.gateway);
	const publicKey = str(v.publicKey);
	if (!id || !gateway || !publicKey || !gatewayOrigin(gateway).ok) return null;
	return {
		id,
		name: str(v.name) ?? id,
		gateway,
		publicKey,
		user: str(v.user),
		pairedAt: str(v.pairedAt) ?? new Date(0).toISOString(),
		// Pins that can't be read never mean none: no silent downgrade, every session is refused.
		pins: v.pins === undefined || v.pins === null ? null : (parsePasskeys(v.pins) ?? []),
		pinnedAt: str(v.pinnedAt),
		pending: parsePending(v.pending),
		undelivered: Array.isArray(v.undelivered)
			? v.undelivered
					.map(parseDecided)
					.filter((d): d is PinsDecision => d !== null)
					.slice(-MAX_UNDELIVERED)
			: []
	};
}

function parsePending(v: unknown): PendingPins | null {
	if (!isObj(v)) return null;
	const id = str(v.id);
	const ref = str(v.ref);
	const passkeys = parsePasskeys(v.passkeys);
	const requestedAt = str(v.requestedAt);
	if (!id || !ref || !passkeys || !requestedAt) return null;
	return { id, ref, passkeys, signedBy: str(v.signedBy) ?? '', requestedAt };
}

/** The most decisions kept for the gateway; past that the oldest is dropped. */
const MAX_UNDELIVERED = 16;

function parseDecided(v: unknown): PinsDecision | null {
	if (!isObj(v) || !str(v.ref) || typeof v.approved !== 'boolean') return null;
	const reason = ['rejected', 'expired', 'replaced'].includes(v.reason as string)
		? (v.reason as PinsDecision['reason'])
		: null;
	return { ref: v.ref as string, approved: v.approved, reason, at: str(v.at) ?? '' };
}

/** The passkeys as the Remotes page and `wheelhouse remote status` show them. */
const shown = (pins: PinnedPasskey[]) =>
	pins.map((p) => ({ name: p.name, fingerprint: passkeyFingerprint(p) }));

/** The pending change as the captain decides on it: what it adds and removes, until it lapses. */
function pendingView(device: CloudDevice): CloudPendingPinsView | null {
	const p = device.pending;
	if (!p || lapsed(p)) return null;
	const now = new Set((device.pins ?? []).map((k) => k.id));
	const next = new Set(p.passkeys.map((k) => k.id));
	return {
		id: p.id,
		passkeys: p.passkeys.map((k) => ({ ...shown([k])[0], added: !now.has(k.id) })),
		removed: shown((device.pins ?? []).filter((k) => !next.has(k.id))),
		signedBy: p.signedBy,
		requestedAt: p.requestedAt,
		expiresAt: new Date(Date.parse(p.requestedAt) + PENDING_PINS_MS).toISOString()
	};
}

function parseSessions(v: unknown): RelaySession[] {
	if (!Array.isArray(v)) return [];
	return v.filter(isObj).flatMap((s) => {
		const id = str(s.id);
		if (!id) return [];
		return [
			{
				id,
				user: str(s.user) ?? '',
				firstAt: str(s.firstAt) ?? '',
				lastAt: str(s.lastAt) ?? '',
				requests: typeof s.requests === 'number' ? s.requests : 0
			}
		];
	});
}

async function writeAtomic(file: string, text: string): Promise<void> {
	await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
	const tmp = `${file}.tmp-${process.pid}-${randomBytes(4).toString('hex')}`;
	try {
		await writeFile(tmp, text, { mode: 0o600 });
		await rename(tmp, file);
	} catch (e) {
		await rm(tmp, { force: true });
		throw e;
	}
}

/** Whether a process is alive (a signal-0 probe; EPERM means it is, under another user). */
export function alive(pid: number): boolean {
	if (!Number.isInteger(pid) || pid <= 0) return false;
	try {
		process.kill(pid, 0);
		return true;
	} catch (e) {
		return (e as NodeJS.ErrnoException).code === 'EPERM';
	}
}

type Settled = { ok: true } | { ok: false; error: string };

export class CloudSettings {
	constructor(
		readonly dir: string,
		private keychain: Keychain | null = null
	) {}

	get file(): string {
		return path.join(this.dir, 'settings.json');
	}
	get keyFile(): string {
		return path.join(this.dir, 'device.key');
	}
	get statusFile(): string {
		return path.join(this.dir, 'status.json');
	}

	/** The settings, with defaults (off, not started, the default gateway, no device) for anything missing or unreadable, with why. */
	async read(): Promise<{ settings: CloudSettingsData; error: string | null }> {
		const settings: CloudSettingsData = {
			enabled: false,
			started: false,
			gateway: DEFAULT_GATEWAY,
			device: null
		};
		let text: string;
		try {
			text = await readFile(this.file, 'utf8');
		} catch (e) {
			if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { settings, error: null };
			return { settings, error: `${this.file} could not be read: ${(e as Error).message}` };
		}
		let parsed: unknown;
		try {
			parsed = JSON.parse(text);
		} catch {
			return { settings, error: `${this.file} is not valid JSON.` };
		}
		if (!isObj(parsed) || parsed.schema !== CLOUD_SETTINGS_SCHEMA) {
			return { settings, error: `${this.file} is not a Wheelhouse Cloud settings file.` };
		}
		const gateway = str(parsed.gateway);
		const origin = gateway ? gatewayOrigin(gateway) : null;
		return {
			settings: {
				enabled: parsed.enabled === true,
				started: parsed.started === true,
				gateway: origin?.ok ? origin.origin : DEFAULT_GATEWAY,
				device: parseDevice(parsed.device)
			},
			error: null
		};
	}

	async update(change: (s: CloudSettingsData) => void): Promise<CloudSettingsData> {
		const { settings } = await this.read();
		change(settings);
		if (!settings.gateway) settings.gateway = DEFAULT_GATEWAY;
		// Only a gateway the captain named is kept, so the default stays the one constant.
		const gateway = settings.gateway === DEFAULT_GATEWAY ? '' : settings.gateway;
		await writeAtomic(
			this.file,
			JSON.stringify({ schema: CLOUD_SETTINGS_SCHEMA, ...settings, gateway }, null, '\t') + '\n'
		);
		return settings;
	}

	/** The Keychain account for this directory's device key, so each config directory has its own. */
	async keychainAccount(): Promise<string> {
		const real = await realpath(this.dir).catch(() => path.resolve(this.dir));
		return `device:${createHash('sha256').update(real).digest('hex').slice(0, 16)}`;
	}

	/** The device key and where it is kept: the Keychain first, then the file. */
	async findKey(): Promise<{ key: DeviceKey; where: string } | null> {
		const kept = this.keychain
			? await this.keychain.get(await this.keychainAccount()).catch(() => null)
			: null;
		const fromKeychain = kept ? importKey(kept) : null;
		if (fromKeychain) return { key: fromKeychain, where: this.keychain!.where };
		try {
			const s = await lstat(this.keyFile);
			if (!s.isFile()) return null;
			if ((s.mode & 0o077) !== 0) await chmod(this.keyFile, 0o600);
			const key = importKey(await readFile(this.keyFile, 'utf8'));
			return key ? { key, where: this.keyFile } : null;
		} catch {
			return null;
		}
	}

	/** Keep the key in the Keychain, else in its file, replacing any before; returns where it went. */
	async setKey(key: DeviceKey): Promise<string> {
		await mkdir(this.dir, { recursive: true, mode: 0o700 });
		const stored = exportKey(key);
		const account = await this.keychainAccount();
		const kept = this.keychain
			? await this.keychain.set(account, stored).then(
					() => true,
					() => false
				)
			: false;
		if (kept) {
			await rm(this.keyFile, { force: true });
			return this.keychain!.where;
		}
		await this.keychain?.remove(account).catch(() => false);
		await writeAtomic(this.keyFile, `${stored}\n`);
		await chmod(this.dir, 0o700).catch(() => {});
		return this.keyFile;
	}

	/** Forget this machine's device: its key wherever it is kept, and its record, and stop remote access. */
	async forget(): Promise<void> {
		await this.keychain?.remove(await this.keychainAccount()).catch(() => false);
		await rm(this.keyFile, { force: true });
		await this.update((s) => {
			s.device = null;
			s.started = false;
		});
	}

	/**
	 * The captain approved, here, the pending change `id` (§6.6): its passkeys
	 * become the ones this machine trusts. Only that change, and only within
	 * its hour: one the gateway has replaced since they looked (even under the
	 * same ref), or one that lapsed, is not approved.
	 */
	approvePins(id: string, now = Date.now()): Promise<Settled> {
		return this.settle(id, now, (device, pending) => {
			device.pins = pending.passkeys;
			device.pinnedAt = new Date(now).toISOString();
			return { approved: true, reason: null };
		});
	}

	/** The captain rejected the pending change `id`: the passkeys trusted stay as they are. */
	rejectPins(id: string, now = Date.now()): Promise<Settled> {
		return this.settle(id, now, () => ({ approved: false, reason: 'rejected' }));
	}

	/** The pending change `id` lapsed with nobody deciding: it counts as rejected. */
	expirePins(id: string, now = Date.now()): Promise<Settled> {
		return this.settle(id, now, () => ({ approved: false, reason: 'expired' }), true);
	}

	private async settle(
		id: string,
		now: number,
		take: (device: CloudDevice, pending: PendingPins) => Omit<PinsDecision, 'ref' | 'at'>,
		lapsing = false
	): Promise<Settled> {
		let error: string | null = null;
		try {
			await this.update((s) => {
				const pending = s.device?.pending;
				if (!s.device || !pending || pending.id !== id) {
					error = 'No such change of passkeys is waiting; look again.';
				} else if (lapsed(pending, now) !== lapsing) {
					error = 'That change of passkeys expired; ask for it again on the gateway.';
				}
				if (error) throw new Error(error);
				const decision = take(s.device!, pending!);
				s.device!.pending = null;
				const list = s.device!.undelivered;
				list.push({ ref: pending!.ref, ...decision, at: new Date(now).toISOString() });
				for (const dropped of list.splice(0, list.length - MAX_UNDELIVERED)) {
					console.warn(
						`Wheelhouse Cloud: dropped the decision on change ${dropped.ref} before the gateway was told; its next connection names the passkeys trusted.`
					);
				}
			});
		} catch (e) {
			if (error) return { ok: false, error };
			throw e;
		}
		return { ok: true };
	}

	async readStatus(): Promise<CloudStatus | null> {
		try {
			const v: unknown = JSON.parse(await readFile(this.statusFile, 'utf8'));
			if (!isObj(v) || v.schema !== CLOUD_STATUS_SCHEMA || typeof v.pid !== 'number') return null;
			const state = v.state === 'online' || v.state === 'stopped' ? v.state : 'connecting';
			return {
				pid: v.pid,
				state,
				reason: str(v.reason),
				gateway: str(v.gateway) ?? '',
				deviceId: str(v.deviceId) ?? '',
				since: str(v.since),
				lastSeen: str(v.lastSeen),
				updatedAt: str(v.updatedAt) ?? '',
				sessions: parseSessions(v.sessions)
			};
		} catch {
			return null;
		}
	}

	async writeStatus(s: CloudStatus): Promise<void> {
		await writeAtomic(
			this.statusFile,
			JSON.stringify({ schema: CLOUD_STATUS_SCHEMA, ...s }, null, '\t') + '\n'
		);
	}

	/** Changes whenever the settings or the key file are written, so a running connector notices. */
	async stamp(): Promise<string> {
		const one = async (f: string) => {
			try {
				const s = await stat(f);
				return `${s.mtimeMs}:${s.size}:${s.ino}`;
			} catch {
				return '-';
			}
		};
		return (await Promise.all([this.file, this.keyFile].map(one))).join('|');
	}

	/** What the Remotes page, Settings → Cloud and `wheelhouse remote status` show. */
	async view(viaRelay = false): Promise<CloudView> {
		const { settings, error } = await this.read();
		const found = settings.device ? await this.findKey() : null;
		const status = await this.readStatus();
		const device: CloudDeviceView | null =
			settings.device && found
				? {
						id: settings.device.id,
						name: settings.device.name,
						user: settings.device.user,
						fingerprint: fingerprint(settings.device.publicKey),
						pairedAt: settings.device.pairedAt,
						passkeys: settings.device.pins ? shown(settings.device.pins) : null,
						pinnedAt: settings.device.pinnedAt,
						pending: pendingView(settings.device)
					}
				: null;
		// The status counts only when its connector is alive and about this device.
		const live =
			status && device && status.deviceId === device.id && alive(status.pid) ? status : null;
		let state: CloudState;
		let reason: string | null = error;
		if (!settings.enabled) state = 'off';
		else if (!device) {
			state = 'not-paired';
			if (settings.device && !found) {
				reason = 'This machine’s device key is missing, so it cannot connect. Pair it again.';
			} else if (status?.state === 'stopped' && status.reason) {
				// Why the last connector stopped, such as the machine being removed on the gateway.
				reason = status.reason;
			}
		} else if (!live) {
			// Not started here and nothing connected (such as `wheelhouse remote run`): remote access is off.
			if (!settings.started) state = 'off';
			else
				state =
					status && status.deviceId === device.id && status.state === 'stopped' && status.reason
						? 'stopped'
						: 'not-running';
			if (state === 'stopped') reason = status!.reason;
		} else {
			state =
				live.state === 'online' ? 'online' : live.state === 'stopped' ? 'stopped' : 'connecting';
			reason = live.reason ?? reason;
		}
		const recent = status && device && status.deviceId === device.id ? status : null;
		return {
			schema: 'wheelhouse-cloud.v1',
			enabled: settings.enabled,
			started: settings.started,
			gateway: settings.gateway,
			device,
			keyStore: found?.where ?? null,
			state,
			reason,
			since: live?.state === 'online' ? live.since : null,
			lastSeen: recent?.lastSeen ?? null,
			sessions: recent?.sessions ?? [],
			viaRelay
		};
	}
}
