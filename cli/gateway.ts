import path from 'node:path';
import { Argument, Command, InvalidArgumentError } from 'commander';
import { version } from '../package.json';
import { GATEWAY_CHANNELS, type GatewayChannel, type GatewayView } from '../src/lib/gateway';
import { resolveInstall } from '../src/lib/server/firstmate/install';
import {
	checkDiscordToken,
	inviteUrl,
	type TokenCheck
} from '../src/lib/server/gateway/channels/discord';
import { defaultKeychain, type Keychain } from '../src/lib/server/gateway/keychain';
import { cleanToken, gatewayDir, GatewaySettings } from '../src/lib/server/gateway/settings';
import { defaultConfigDir } from '../src/lib/server/plugins/config';
import { isInside } from '../src/lib/server/store/store';

/**
 * `wheelhouse gateway …`: set a channel's bot token (`connect`, which reads it
 * from a hidden prompt or stdin, never from the command line, where `ps`
 * would show it, and keeps it in the macOS Keychain, else a file only the
 * captain can read), turn a channel on or off, unbind its account, send
 * alerts as titles only, and show where things stand. Pairing itself starts in Wheelhouse's
 * Settings → Gateway page. A running Wheelhouse picks up each change within
 * seconds.
 */

export interface GatewayCliDeps {
	env: NodeJS.ProcessEnv;
	/** Read the token: a hidden prompt on a terminal, else all of stdin. */
	readSecret: (question: string) => Promise<string>;
	check: (token: string) => Promise<TokenCheck | { ok: false; error: string }>;
	/** Where the token is kept first; null keeps it in its file. */
	keychain: Keychain | null;
	/** The running Wheelhouse's view of the gateway, or null when none answers. */
	live: (port: number) => Promise<GatewayView | null>;
	log: (line: string) => void;
	error: (line: string) => void;
}

const CHANNELS = GATEWAY_CHANNELS.map((c) => c.channel);
const labelOf = (c: GatewayChannel) => GATEWAY_CHANNELS.find((x) => x.channel === c)!.label;

function parseChannel(v: string): GatewayChannel {
	if (!CHANNELS.includes(v as GatewayChannel)) {
		throw new InvalidArgumentError(`Channels: ${CHANNELS.join(', ')}.`);
	}
	return v as GatewayChannel;
}

function parsePort(value: string): number {
	const n = Number(value);
	if (!Number.isInteger(n) || n < 1 || n > 65535) {
		throw new InvalidArgumentError('Port must be a whole number from 1 to 65535.');
	}
	return n;
}

/** Read a secret without echoing it on a terminal; from a pipe, read all of stdin. */
export async function readSecret(question: string): Promise<string> {
	const input = process.stdin;
	if (!input.isTTY) {
		const chunks: Buffer[] = [];
		for await (const c of input) chunks.push(Buffer.from(c as Buffer));
		return Buffer.concat(chunks).toString('utf8');
	}
	process.stdout.write(question);
	input.setRawMode(true);
	input.setEncoding('utf8');
	input.resume();
	return new Promise((resolve, reject) => {
		let value = '';
		const stop = () => {
			input.off('data', onData);
			input.setRawMode(false);
			input.pause();
			process.stdout.write('\n');
		};
		const onData = (s: string) => {
			for (const ch of s) {
				if (ch === '\r' || ch === '\n') {
					stop();
					return resolve(value);
				}
				if (ch === '\u0003' || ch === '\u0004') {
					stop();
					return reject(new Error('cancelled'));
				}
				if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1);
				else value += ch;
			}
		};
		input.on('data', onData);
	});
}

async function liveView(port: number): Promise<GatewayView | null> {
	try {
		const r = await fetch(`http://127.0.0.1:${port}/api/gateway`, {
			signal: AbortSignal.timeout(1500)
		});
		return r.ok ? ((await r.json()) as GatewayView) : null;
	} catch {
		return null;
	}
}

export function gatewayCommand(over: Partial<GatewayCliDeps> = {}): Command {
	const deps: GatewayCliDeps = {
		env: process.env,
		readSecret,
		check: (token) => checkDiscordToken(token, { version }),
		keychain: defaultKeychain(),
		live: liveView,
		log: (line) => console.log(line),
		error: (line) => console.error(line),
		...over
	};
	const cmd = new Command('gateway')
		.description('Reach Firstmate from your phone: set up the chat channels (Discord).')
		.option(
			'--config-dir <dir>',
			'the Wheelhouse config directory (default: $WHEELHOUSE_CONFIG_DIR, else $XDG_CONFIG_HOME/wheelhouse, else ~/.config/wheelhouse)'
		);

	/** The settings, or null (with why) when the config directory sits in the Firstmate home. */
	const settingsFor = (c: Command): GatewaySettings | null => {
		const dir = c.optsWithGlobals().configDir as string | undefined;
		const configDir = dir ? path.resolve(dir) : defaultConfigDir(deps.env);
		const found = resolveInstall({ cwd: process.cwd(), env: deps.env });
		if (found.ok && isInside(configDir, found.install.homeDir)) {
			deps.error(
				`wheelhouse: the config directory ${configDir} is inside the Firstmate home, where the crew can read it. Pass --config-dir <dir> outside it.`
			);
			process.exitCode = 1;
			return null;
		}
		return new GatewaySettings(gatewayDir(configDir), deps.keychain);
	};
	const fail = (line: string) => {
		deps.error(`wheelhouse: ${line}`);
		process.exitCode = 1;
	};

	cmd
		.command('connect <channel>')
		.description(
			'Set the bot token for a channel (asked for here, never taken from the command line).'
		)
		.action(async (channel: string, _o: unknown, c: Command) => {
			const ch = parseChannel(channel);
			const settings = settingsFor(c);
			if (!settings) return;
			let raw: string;
			try {
				raw = await deps.readSecret(`${labelOf(ch)} bot token (input hidden): `);
			} catch {
				return fail('cancelled; nothing was changed.');
			}
			const token = cleanToken(raw);
			if (!token) {
				return fail(
					'that does not look like a bot token. Copy it from the Bot page of your application in the Discord Developer Portal (Reset Token).'
				);
			}
			const checked = await deps.check(token);
			if (!checked.ok) return fail(`${checked.error} Nothing was changed.`);
			const where = await settings.setToken(ch, token);
			deps.log(`Saved the ${labelOf(ch)} bot token in ${where} (readable by you only).`);
			deps.log(`Bot: ${checked.bot.name} (id ${checked.bot.id}).`);
			if (checked.publicBot) {
				deps.log(
					'Warning: "Public Bot" is on, so anyone with its link can add it to their server. Turn it off on the Bot page.'
				);
			}
			deps.log(
				`Add it to a private server you are in (it needs no permissions): ${inviteUrl(checked.appId)}`
			);
			deps.log('Next: in Wheelhouse, open Settings → Gateway and pair your account.');
		});

	for (const [name, on] of [
		['on', true],
		['off', false]
	] as const) {
		cmd
			.command(`${name} [channel]`)
			.description(
				on
					? 'Turn a channel on (default: discord).'
					: 'Turn a channel off: it neither reads nor sends (default: discord).'
			)
			.action(async (channel: string | undefined, _o: unknown, c: Command) => {
				const ch = parseChannel(channel ?? 'discord');
				const settings = settingsFor(c);
				if (!settings) return;
				await settings.update((s) => (s[ch].enabled = on));
				deps.log(`${labelOf(ch)} is turned ${name}.`);
			});
	}

	cmd
		.command('unbind [channel]')
		.description(
			'Forget the paired account: no one’s messages reach Firstmate until you pair again (default: discord).'
		)
		.action(async (channel: string | undefined, _o: unknown, c: Command) => {
			const ch = parseChannel(channel ?? 'discord');
			const settings = settingsFor(c);
			if (!settings) return;
			const { settings: before } = await settings.read();
			await settings.update((s) => (s[ch].paired = null));
			deps.log(
				before[ch].paired
					? `Unbound ${before[ch].paired!.name} from ${labelOf(ch)}.`
					: `No account was bound to ${labelOf(ch)}.`
			);
		});

	cmd
		.command('titles-only')
		.addArgument(new Argument('<state>', 'on or off').choices(['on', 'off']))
		.argument('[channel]')
		.description(
			'Send alerts and decisions as their titles only, without their text, or in full again (default: discord).'
		)
		.action(async (state: 'on' | 'off', channel: string | undefined, _o: unknown, c: Command) => {
			const ch = parseChannel(channel ?? 'discord');
			const settings = settingsFor(c);
			if (!settings) return;
			await settings.update((s) => (s[ch].titlesOnly = state === 'on'));
			deps.log(
				state === 'on'
					? `${labelOf(ch)} sends alerts and decisions as titles only.`
					: `${labelOf(ch)} sends alerts and decisions in full.`
			);
		});

	cmd
		.command('status')
		.description(
			'Show each channel: its token, whether it is on, who is paired, and the connection.'
		)
		.option('--port <n>', 'the port the running Wheelhouse listens on', parsePort, 4310)
		.action(async (o: { port: number }, c: Command) => {
			const settings = settingsFor(c);
			if (!settings) return;
			const { settings: s, error } = await settings.read();
			if (error) deps.log(`Warning: ${error}`);
			const live = await deps.live(o.port);
			for (const { channel, label } of GATEWAY_CHANNELS) {
				const cs = s[channel];
				const token = await settings.find(channel);
				const lv = live?.channels.find((x) => x.channel === channel);
				deps.log(label);
				deps.log(
					`  Bot token:   ${token ? `set (${token.where})` : `not set (wheelhouse gateway connect ${channel})`}`
				);
				deps.log(`  Turned:      ${cs.enabled ? 'on' : 'off'}`);
				deps.log(
					`  Paired:      ${cs.paired ? `${cs.paired.name} (id ${cs.paired.id}), since ${cs.paired.at.slice(0, 10)}` : 'no one (pair in Settings → Gateway)'}`
				);
				deps.log(`  Alerts:      ${cs.alerts.length ? cs.alerts.join(', ') : 'none'}`);
				deps.log(`  Titles only: ${cs.titlesOnly ? 'on' : 'off'}`);
				deps.log(
					`  Connection:  ${
						lv
							? `${lv.state}${lv.bot && lv.state === 'connected' ? ` as ${lv.bot.name}` : ''}${lv.reason ? ` (${lv.reason})` : ''}`
							: `no Wheelhouse answers on port ${o.port}; the gateway runs only while Wheelhouse does`
					}`
				);
			}
		});
	return cmd;
}
