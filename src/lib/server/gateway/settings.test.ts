import {
	chmodSync,
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Keychain } from './keychain';
import { cleanToken, GatewaySettings } from './settings';

const TOKEN = 'fake-bot-token.for-wheelhouse-tests.not-a-real-discord-token';
const NEW_TOKEN = 'fake-bot-token.for-wheelhouse-tests.a-second-fake-for-rotation';

/** A Keychain in memory; `broken` makes it fail as one that cannot be used. */
function memoryKeychain() {
	const items = new Map<string, string>();
	const k = {
		items,
		broken: false as boolean,
		where: 'the macOS Keychain (wheelhouse-gateway)',
		async get(account: string) {
			if (k.broken) throw new Error('no Keychain');
			return items.get(account) ?? null;
		},
		async set(account: string, secret: string) {
			if (k.broken) throw new Error('no Keychain');
			items.set(account, secret);
		},
		async remove(account: string) {
			if (k.broken) throw new Error('no Keychain');
			return items.delete(account);
		}
	} satisfies Keychain & { items: Map<string, string>; broken: boolean };
	return k;
}

let dir: string;
let settings: GatewaySettings;
beforeEach(() => {
	dir = mkdtempSync(path.join(tmpdir(), 'wh-gw-settings-'));
	settings = new GatewaySettings(path.join(dir, 'gateway'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('cleanToken', () => {
	it('takes a pasted bot token, with or without "Bot ", and nothing else', () => {
		expect(cleanToken(`  ${TOKEN}\n`)).toBe(TOKEN);
		expect(cleanToken(`Bot ${TOKEN}`)).toBe(TOKEN);
		expect(cleanToken('https://discord.com/developers/applications')).toBeNull();
		expect(cleanToken('short.to.ken')).toBeNull();
		expect(cleanToken(`${TOKEN} extra`)).toBeNull();
	});
});

describe('GatewaySettings', () => {
	it('starts with Discord on, unpaired, sending the default alerts', async () => {
		expect(await settings.read()).toEqual({
			settings: {
				discord: {
					enabled: true,
					paired: null,
					alerts: ['question', 'pr-green', 'stuck'],
					titlesOnly: false
				}
			},
			error: null
		});
	});

	it('keeps the token alone in a file only the captain can read', async () => {
		await settings.setToken('discord', TOKEN);
		const file = settings.tokenFile('discord');
		expect(statSync(file).mode & 0o777).toBe(0o600);
		expect(statSync(path.dirname(file)).mode & 0o777).toBe(0o700);
		expect(await settings.token('discord')).toBe(TOKEN);
		// Widened by something else: narrowed again on read.
		chmodSync(file, 0o644);
		expect(await settings.token('discord')).toBe(TOKEN);
		expect(statSync(file).mode & 0o777).toBe(0o600);
		await settings.update((s) => (s.discord.enabled = false));
		expect(readFileSync(settings.file, 'utf8')).not.toContain(TOKEN);
	});

	it('ignores a token file that is a link to somewhere else', async () => {
		const elsewhere = path.join(dir, 'elsewhere');
		writeFileSync(elsewhere, TOKEN);
		await settings.update(() => {});
		symlinkSync(elsewhere, settings.tokenFile('discord'));
		expect(await settings.token('discord')).toBeNull();
	});

	it('keeps only valid pairings and alert kinds from the file, and says when it is unreadable', async () => {
		await settings.update((s) => {
			s.discord.paired = { id: '123', name: 'Captain', dm: '9', at: '2026-10-29T10:00:00Z' };
		});
		const raw = JSON.parse(readFileSync(settings.file, 'utf8'));
		raw.discord.alerts = ['question', 'nonsense'];
		writeFileSync(settings.file, JSON.stringify(raw));
		expect((await settings.read()).settings.discord).toMatchObject({
			paired: { id: '123' },
			alerts: ['question']
		});
		raw.discord.paired.id = 'not-a-snowflake';
		writeFileSync(settings.file, JSON.stringify(raw));
		expect((await settings.read()).settings.discord.paired).toBeNull();
		writeFileSync(settings.file, '{');
		expect((await settings.read()).error).toMatch(/not valid JSON/);
	});

	it('keeps the token in the Keychain first, and only there', async () => {
		const keychain = memoryKeychain();
		const kept = new GatewaySettings(path.join(dir, 'gateway'), keychain);
		await settings.setToken('discord', TOKEN);
		expect(await kept.setToken('discord', NEW_TOKEN)).toBe(keychain.where);
		expect(keychain.items.get(await kept.keychainAccount('discord'))).toBe(NEW_TOKEN);
		// The file from before is gone, so no old token is left on disk.
		expect(existsSync(kept.tokenFile('discord'))).toBe(false);
		expect(await kept.find('discord')).toEqual({ token: NEW_TOKEN, where: keychain.where });
	});

	it('gives each config directory its own Keychain item', async () => {
		const keychain = memoryKeychain();
		const one = new GatewaySettings(path.join(dir, 'one', 'gateway'), keychain);
		const other = new GatewaySettings(path.join(dir, 'other', 'gateway'), keychain);
		await one.setToken('discord', TOKEN);
		expect(await one.keychainAccount('discord')).not.toBe(await other.keychainAccount('discord'));
		expect(await other.find('discord')).toBeNull();
		// The same directory, read by another process (the server, the CLI), finds it.
		const again = new GatewaySettings(path.join(dir, 'one', 'gateway'), keychain);
		expect(await again.token('discord')).toBe(TOKEN);
	});

	it('falls back to the file when the Keychain cannot be used', async () => {
		const keychain = memoryKeychain();
		const kept = new GatewaySettings(path.join(dir, 'gateway'), keychain);
		await kept.setToken('discord', TOKEN);
		keychain.broken = true;
		expect(await kept.setToken('discord', NEW_TOKEN)).toBe(kept.tokenFile('discord'));
		expect(statSync(kept.tokenFile('discord')).mode & 0o777).toBe(0o600);
		expect(await kept.find('discord')).toEqual({
			token: NEW_TOKEN,
			where: kept.tokenFile('discord')
		});
	});

	it('changes its stamp when a token goes into the Keychain', async () => {
		const kept = new GatewaySettings(path.join(dir, 'gateway'), memoryKeychain());
		await kept.update(() => {});
		const before = await kept.stamp();
		await kept.setToken('discord', TOKEN);
		expect(await kept.stamp()).not.toBe(before);
	});

	it('changes its stamp whenever a file changes', async () => {
		const before = await settings.stamp();
		await settings.setToken('discord', TOKEN);
		const mid = await settings.stamp();
		await settings.update((s) => (s.discord.alerts = []));
		expect(new Set([before, mid, await settings.stamp()]).size).toBe(3);
	});
});
