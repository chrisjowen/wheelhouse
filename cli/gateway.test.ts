import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { GatewayView } from '../src/lib/gateway';
import { gatewayDir, GatewaySettings } from '../src/lib/server/gateway/settings';
import { gatewayCommand, type GatewayCliDeps } from './gateway';

/** `wheelhouse gateway` against a temporary config directory, with Discord and the server faked. */

const TOKEN = 'fake-bot-token.for-wheelhouse-tests.not-a-real-discord-token';

let dir: string;
let out: string[];
let settings: GatewaySettings;

beforeEach(() => {
	dir = mkdtempSync(path.join(tmpdir(), 'wh-gw-cli-'));
	out = [];
	settings = new GatewaySettings(gatewayDir(path.join(dir, 'config')));
});
afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
	process.exitCode = undefined;
});

async function run(args: string[], over: Partial<GatewayCliDeps> = {}) {
	const cmd = gatewayCommand({
		env: { HOME: dir },
		readSecret: async () => `${TOKEN}\n`,
		check: async () => ({
			ok: true,
			bot: { id: '999', name: 'wheelhouse-bot' },
			appId: '777',
			publicBot: false
		}),
		keychain: null,
		live: async () => null,
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

describe('wheelhouse gateway connect', () => {
	it('reads the token from the prompt, checks it with Discord and stores it for the captain only', async () => {
		await run(['connect', 'discord']);
		expect(await settings.token('discord')).toBe(TOKEN);
		expect(statSync(settings.tokenFile('discord')).mode & 0o777).toBe(0o600);
		expect(out.join('\n')).not.toContain(TOKEN);
		expect(out).toEqual([
			expect.stringMatching(
				/^Saved the Discord bot token in .*discord\.token \(readable by you only\)\.$/
			),
			'Bot: wheelhouse-bot (id 999).',
			'Add it to a private server you are in (it needs no permissions): https://discord.com/oauth2/authorize?client_id=777&scope=bot&permissions=0',
			'Next: in Wheelhouse, open Settings → Gateway and pair your account.'
		]);
	});

	it('keeps the token in the Keychain when there is one, off the command line', async () => {
		const items = new Map<string, string>();
		const keychain = {
			where: 'the macOS Keychain (wheelhouse-gateway)',
			get: async (a: string) => items.get(a) ?? null,
			set: async (a: string, s: string) => void items.set(a, s),
			remove: async (a: string) => items.delete(a)
		};
		await run(['connect', 'discord'], { keychain });
		expect(items.get(await settings.keychainAccount('discord'))).toBe(TOKEN);
		expect(existsSync(settings.tokenFile('discord'))).toBe(false);
		expect(out[0]).toBe(
			'Saved the Discord bot token in the macOS Keychain (wheelhouse-gateway) (readable by you only).'
		);
		out = [];
		await run(['status'], { keychain });
		expect(out[1]).toBe('  Bot token:   set (the macOS Keychain (wheelhouse-gateway))');
	});

	it('warns when anyone can add the bot', async () => {
		await run(['connect', 'discord'], {
			check: async () => ({ ok: true, bot: { id: '9', name: 'b' }, appId: '9', publicBot: true })
		});
		expect(out).toContainEqual(expect.stringMatching(/"Public Bot" is on/));
	});

	it('stores nothing when the text is not a token or Discord refuses it', async () => {
		await run(['connect', 'discord'], { readSecret: async () => 'https://discord.com/app' });
		expect(out[0]).toMatch(/does not look like a bot token/);
		expect(process.exitCode).toBe(1);
		await run(['connect', 'discord'], {
			check: async () => ({ ok: false, error: 'Discord refused this token.' })
		});
		expect(out[1]).toBe('wheelhouse: Discord refused this token. Nothing was changed.');
		expect(existsSync(settings.tokenFile('discord'))).toBe(false);
	});

	it('never takes the token from the command line', async () => {
		await expect(run(['connect', 'discord', TOKEN])).rejects.toThrow(/too many arguments/i);
		expect(existsSync(settings.tokenFile('discord'))).toBe(false);
	});

	it('knows only the channels it supports', async () => {
		await expect(run(['connect', 'whatsapp'])).rejects.toThrow();
	});
});

describe('the other commands', () => {
	it('turns a channel off and on, unbinds its account and sends titles only', async () => {
		await settings.setToken('discord', TOKEN);
		await settings.update(
			(s) =>
				(s.discord.paired = { id: '123', name: 'Captain', dm: null, at: '2026-10-29T10:00:00Z' })
		);
		await run(['off']);
		expect((await settings.read()).settings.discord.enabled).toBe(false);
		await run(['on', 'discord']);
		expect((await settings.read()).settings.discord.enabled).toBe(true);
		await run(['unbind']);
		expect((await settings.read()).settings.discord.paired).toBeNull();
		await run(['titles-only', 'on']);
		expect((await settings.read()).settings.discord.titlesOnly).toBe(true);
		await run(['titles-only', 'off', 'discord']);
		expect((await settings.read()).settings.discord.titlesOnly).toBe(false);
		expect(out).toEqual([
			'Discord is turned off.',
			'Discord is turned on.',
			'Unbound Captain from Discord.',
			'Discord sends alerts and decisions as titles only.',
			'Discord sends alerts and decisions in full.'
		]);
		await expect(run(['titles-only', 'maybe'])).rejects.toThrow();
		await expect(run(['disconnect', 'discord'])).rejects.toThrow();
		await expect(run(['unpair'])).rejects.toThrow();
	});

	it('shows each channel, with the connection the running Wheelhouse reports', async () => {
		await settings.setToken('discord', TOKEN);
		const live: GatewayView = {
			schema: 'wheelhouse-gateway.v1',
			available: true,
			reason: null,
			settingsDir: settings.dir,
			channels: [
				{
					channel: 'discord',
					label: 'Discord',
					token: true,
					enabled: true,
					state: 'connected',
					reason: null,
					bot: { id: '999', name: 'wheelhouse-bot' },
					paired: null,
					pairing: null,
					pairingNote: null,
					alerts: ['question'],
					titlesOnly: false,
					tokenStore: settings.tokenFile('discord')
				}
			]
		};
		await run(['status'], { live: async () => live });
		expect(out).toEqual([
			'Discord',
			`  Bot token:   set (${settings.tokenFile('discord')})`,
			'  Turned:      on',
			'  Paired:      no one (pair in Settings → Gateway)',
			'  Alerts:      question, pr-green, stuck',
			'  Titles only: off',
			'  Connection:  connected as wheelhouse-bot'
		]);
		out = [];
		await run(['status', '--port', '4999']);
		expect(out.at(-1)).toBe(
			'  Connection:  no Wheelhouse answers on port 4999; the gateway runs only while Wheelhouse does'
		);
		expect(out.join('\n')).not.toContain(TOKEN);
	});
});
