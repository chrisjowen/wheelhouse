import { mkdirSync } from 'node:fs';
import type { IncomingMessage } from 'node:http';
import path from 'node:path';
import type { Duplex } from 'node:stream';
import { agentName } from '../../agent';
import { parseHarness } from '../../harness';
import { SETUP_TERMINAL_PATH } from '../../setup';
import { defaultConfigDir } from '../plugins/config';
import { isTerminalUrl, refuseUpgrade, TerminalServer, type SpawnPty } from '../sessions/terminal';
import { which } from '../sessions/tmux';
import { defaultStateDir } from '../store/store';
import { signInArgv } from './agents';
import { currentChoice } from './agentchoice';
import { readAnswers } from './answers';

/**
 * The setup wizard's terminal: the same live terminal as the Firstmate
 * session's drawer (sessions/terminal.ts: a loopback Host, Wheelhouse's own
 * Origin and this launch's session token, or no pty starts), but at
 * SETUP_TERMINAL_PATH and running the chosen agent's own sign-in in a pty of
 * its own (`claude`, `codex login`, or `pi`, where the captain types /login),
 * so the captain signs in and accepts its terms with their own keys.
 *
 * It runs in a folder of Wheelhouse's own, never the Firstmate checkout (whose
 * hooks would start a Firstmate session). Nothing typed or shown is kept:
 * the pty's output goes to the socket and nowhere else. Each socket has its own
 * pty, killed when the socket closes (the step ends, or the page leaves) and
 * when the wizard says the step is done (`closeAll`).
 */

const LOOPBACK_ADDRESS = /^(127\.\d+\.\d+\.\d+|::1|::ffff:127\.\d+\.\d+\.\d+)$/;

export const isLoopbackAddress = (a: string | undefined | null) => LOOPBACK_ADDRESS.test(a ?? '');

/**
 * Whether setup refuses a caller: anyone not on this computer, and anyone
 * reaching it through Wheelhouse Cloud (the connector, which marks every
 * relayed request with `X-Wheelhouse-Remote: 1` after dropping any the browser
 * sent, connects from this computer).
 */
export const refusesSetup = (
	address: string | undefined | null,
	remoteHeader: string | null | undefined
) => !isLoopbackAddress(address) || remoteHeader === '1';

export const isSetupTerminalUrl = (url: string | undefined) =>
	isTerminalUrl(url, SETUP_TERMINAL_PATH);

/** Wheelhouse's own folder for the agent during setup, in its state directory. */
export const setupWorkDir = (env: NodeJS.ProcessEnv) =>
	path.join(defaultStateDir(env), 'setup', 'claude');

export type SignIn = { ok: true; argv: string[] } | { ok: false; error: string };

/** The sign-in command for the agent the wizard has chosen, as its settings say now. */
export function chosenSignIn(
	env: NodeJS.ProcessEnv,
	find: (name: string) => string | null
): SignIn {
	const configDir = defaultConfigDir(env);
	const answers = readAnswers(configDir);
	let choice;
	try {
		choice = currentChoice(parseHarness(env.WHEELHOUSE_HARNESS), configDir, answers);
	} catch (e) {
		return { ok: false, error: (e as Error).message };
	}
	if (!choice) return { ok: false, error: 'This agent signs in using its own terminal.' };
	const bin = find(choice.agent);
	if (!bin) return { ok: false, error: `Install ${agentName(choice.agent)} first.` };
	return signInArgv(choice, bin, answers.state === 'ok');
}

export interface SetupTerminalOptions {
	env?: NodeJS.ProcessEnv;
	spawn?: SpawnPty;
	find?: (name: string) => string | null;
	/** The sign-in command (default: the wizard's chosen agent's). */
	signIn?: () => SignIn;
}

export class SetupTerminals {
	private server: TerminalServer;

	constructor(opts: SetupTerminalOptions = {}) {
		const env = opts.env ?? process.env;
		const find = opts.find ?? ((n: string) => which(n, env.PATH));
		const signIn = opts.signIn ?? (() => chosenSignIn(env, find));
		this.server = new TerminalServer({
			path: SETUP_TERMINAL_PATH,
			spawn: opts.spawn,
			resolve: async () => {
				const command = signIn();
				if (!command.ok) return { ok: false, status: 404, error: command.error };
				const cwd = setupWorkDir(env);
				mkdirSync(cwd, { recursive: true });
				return {
					ok: true,
					target: { argv: command.argv, cwd, env: { ...env, TERM: 'xterm-256color' } }
				};
			}
		});
	}

	get connections(): number {
		return this.server.connections;
	}

	/** Take the upgrade if it is the setup terminal's; refuses any caller not on this computer. */
	handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): boolean {
		if (!isSetupTerminalUrl(req.url)) return false;
		const remote = req.headers['x-wheelhouse-remote'];
		if (refusesSetup(req.socket.remoteAddress, Array.isArray(remote) ? remote[0] : remote)) {
			refuseUpgrade(socket, 403, 'Setup only runs on this computer.');
			return true;
		}
		return this.server.handleUpgrade(req, socket, head);
	}

	/** End the step: close every setup terminal and kill its agent. */
	closeAll(reason = 'This step is finished.'): void {
		this.server.closeAll(reason);
	}
}

const KEY = Symbol.for('wheelhouse.setup-terminals');
const g = globalThis as unknown as Record<symbol, SetupTerminals | undefined>;

/** This process's setup terminals (stable across module reloads). */
export function setupTerminals(): SetupTerminals {
	g[KEY] ??= new SetupTerminals();
	return g[KEY];
}
