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
import { ALERT_KINDS } from '../../bell';
import { DEFAULT_GATEWAY_ALERTS, GATEWAY_CHANNELS, type GatewayChannel } from '../../gateway';
import type { AlertKind } from '../../types';
import type { Keychain } from './keychain';

/**
 * The gateway's settings, in the captain-owned config directory
 * (`<config-dir>/gateway/`, never the Firstmate home, a project clone or a
 * worktree): `settings.json` says, per channel, whether it is on, which
 * account it is paired with, which bell alerts it sends and whether they go
 * as titles only. A channel's bot token is kept in the macOS Keychain; where
 * that cannot be used, `<channel>.token` holds it, alone, readable by the
 * captain's user only (0600 in a 0700 directory).
 *
 * The server and `wheelhouse gateway` both read and write these; the server
 * notices a change the CLI made (stamp) and applies it. The token is read
 * only here, is never logged, and is never put in the environment of
 * anything Wheelhouse starts.
 */

export const GATEWAY_SETTINGS_SCHEMA = 'wheelhouse-gateway-settings.v1';
export const SETTINGS_FILE = 'settings.json';

export interface PairedPeer {
	/** The platform's immutable user id. */
	id: string;
	/** The display name when it paired, for Settings only. */
	name: string;
	/** The direct-message chat with it. */
	dm: string | null;
	at: string;
}

export interface ChannelSettings {
	enabled: boolean;
	paired: PairedPeer | null;
	alerts: AlertKind[];
	/** Alerts and Decisions cards go as their titles only, without their text. */
	titlesOnly: boolean;
}

export type Settings = Record<GatewayChannel, ChannelSettings>;

/** The gateway directory inside a Wheelhouse config directory. */
export const gatewayDir = (configDir: string) => path.join(configDir, 'gateway');

export function defaultSettings(): Settings {
	return Object.fromEntries(
		GATEWAY_CHANNELS.map((c) => [
			c.channel,
			{ enabled: true, paired: null, alerts: [...DEFAULT_GATEWAY_ALERTS], titlesOnly: false }
		])
	) as Settings;
}

/**
 * A bot token as pasted: a leading "Bot " is dropped and surrounding space
 * trimmed. Null when it does not look like a Discord bot token (three
 * dot-separated base64url parts), so a pasted URL or message never gets stored.
 */
export function cleanToken(raw: string): string | null {
	const t = raw.trim().replace(/^Bot\s+/i, '');
	if (t.length < 50 || t.length > 200) return null;
	return /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(t) ? t : null;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const KINDS = new Set(ALERT_KINDS.map((k) => k.kind));

function parsePeer(v: unknown): PairedPeer | null {
	if (!isObj(v)) return null;
	const id = str(v.id);
	if (!id || !/^\d{1,32}$/.test(id)) return null;
	return { id, name: str(v.name) ?? id, dm: str(v.dm), at: str(v.at) ?? new Date(0).toISOString() };
}

function parseChannel(v: unknown, fallback: ChannelSettings): ChannelSettings {
	if (!isObj(v)) return fallback;
	return {
		enabled: typeof v.enabled === 'boolean' ? v.enabled : fallback.enabled,
		paired: parsePeer(v.paired),
		alerts: Array.isArray(v.alerts)
			? v.alerts.filter((k): k is AlertKind => KINDS.has(k as AlertKind))
			: fallback.alerts,
		titlesOnly: typeof v.titlesOnly === 'boolean' ? v.titlesOnly : fallback.titlesOnly
	};
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

export class GatewaySettings {
	constructor(
		readonly dir: string,
		private keychain: Keychain | null = null
	) {}

	get file(): string {
		return path.join(this.dir, SETTINGS_FILE);
	}

	tokenFile(channel: GatewayChannel): string {
		return path.join(this.dir, `${channel}.token`);
	}

	/** The settings, with defaults for anything missing; an unreadable file reads as the defaults, with why. */
	async read(): Promise<{ settings: Settings; error: string | null }> {
		const settings = defaultSettings();
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
		if (!isObj(parsed) || parsed.schema !== GATEWAY_SETTINGS_SCHEMA) {
			return { settings, error: `${this.file} is not a Wheelhouse gateway settings file.` };
		}
		for (const { channel } of GATEWAY_CHANNELS) {
			settings[channel] = parseChannel(parsed[channel], settings[channel]);
		}
		return { settings, error: null };
	}

	/** Change the settings and write them; an unreadable file is replaced with the change applied to the defaults. */
	async update(change: (s: Settings) => void): Promise<Settings> {
		const { settings } = await this.read();
		change(settings);
		await writeAtomic(
			this.file,
			JSON.stringify({ schema: GATEWAY_SETTINGS_SCHEMA, ...settings }, null, '\t') + '\n'
		);
		return settings;
	}

	/**
	 * The channel's bot token and where it is kept, or null when none is set:
	 * the Keychain first, then the file. A token file that is not a plain file
	 * is ignored.
	 */
	async find(channel: GatewayChannel): Promise<{ token: string; where: string } | null> {
		const kept = this.keychain
			? await this.keychain.get(await this.keychainAccount(channel)).catch(() => null)
			: null;
		const fromKeychain = kept ? cleanToken(kept) : null;
		if (fromKeychain) return { token: fromKeychain, where: this.keychain!.where };
		const file = this.tokenFile(channel);
		try {
			const s = await lstat(file);
			if (!s.isFile()) return null;
			// Kept the captain's alone even if something widened it.
			if ((s.mode & 0o077) !== 0) await chmod(file, 0o600);
			const token = cleanToken(await readFile(file, 'utf8'));
			return token ? { token, where: file } : null;
		} catch {
			return null;
		}
	}

	async token(channel: GatewayChannel): Promise<string | null> {
		return (await this.find(channel))?.token ?? null;
	}

	/**
	 * The Keychain account for the channel's token in this directory: the
	 * channel and a digest of the directory's real path, so each config
	 * directory has its own token.
	 */
	async keychainAccount(channel: GatewayChannel): Promise<string> {
		const real = await realpath(this.dir).catch(() => path.resolve(this.dir));
		return `${channel}:${createHash('sha256').update(real).digest('hex').slice(0, 16)}`;
	}

	/** Keep the token in the Keychain, else in its file, replacing the one before; returns where it went. */
	async setToken(channel: GatewayChannel, token: string): Promise<string> {
		await mkdir(this.dir, { recursive: true, mode: 0o700 });
		const keychain = this.keychain;
		const account = await this.keychainAccount(channel);
		const kept = keychain
			? await keychain.set(account, token).then(
					() => true,
					() => false
				)
			: false;
		if (kept) {
			await rm(this.tokenFile(channel), { force: true });
		} else {
			await keychain?.remove(account).catch(() => false);
			await writeAtomic(this.tokenFile(channel), `${token}\n`);
			await chmod(this.dir, 0o700).catch(() => {});
		}
		// The Keychain has no stamp of its own: rewriting the settings is what a running Wheelhouse notices.
		await this.update(() => {});
		return kept ? keychain!.where : this.tokenFile(channel);
	}

	/** Remove the channel's bot token from the Keychain and its file; returns whether there was one. */
	async clearToken(channel: GatewayChannel): Promise<boolean> {
		const fromKeychain = this.keychain
			? await this.keychain.remove(await this.keychainAccount(channel)).catch(() => false)
			: false;
		const fromFile = await rm(this.tokenFile(channel)).then(
			() => true,
			() => false
		);
		await this.update(() => {});
		return fromKeychain || fromFile;
	}

	/** Changes whenever a file is written (setting a Keychain token rewrites the settings), so the server can pick up what the CLI changed. */
	async stamp(): Promise<string> {
		const one = async (f: string) => {
			try {
				const s = await stat(f);
				return `${s.mtimeMs}:${s.size}:${s.ino}`;
			} catch {
				return '-';
			}
		};
		const files = [this.file, ...GATEWAY_CHANNELS.map((c) => this.tokenFile(c.channel))];
		return (await Promise.all(files.map(one))).join('|');
	}
}
