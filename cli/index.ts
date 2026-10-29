#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Command, InvalidArgumentError, Option } from 'commander';
import { version } from '../package.json';
import { checkCompatibility, resolveInstall } from '../src/lib/server/firstmate/install';
import { defaultConfigDir } from '../src/lib/server/plugins/config';
import { defaultPluginsDir } from '../src/lib/server/plugins/installed';
import { defaultStateDir, isInside } from '../src/lib/server/store/store';
import { pluginCommand } from './plugin';
import { newToken, removeRunning, restartHandler, RESTART_EXIT, writeRunning } from './running';

/**
 * `wheelhouse open`: find Firstmate, check its integration scripts, start the
 * Wheelhouse server on loopback and open the browser. It also starts the one Firstmate session - an interactive `claude` in
 * Firstmate's checkout, inside a tmux session on Wheelhouse's own tmux server
 * - when no Firstmate session is running; when one already holds Firstmate's
 * session lock, it shows that one instead and never starts a second. The home
 * page is the conversation with it. Wheelhouse never stops Firstmate: closing
 * it leaves Firstmate's session and its crew running. Wheelhouse keeps its own
 * records in a state directory outside the Firstmate home.
 *
 * `wheelhouse open` itself only supervises: it runs the server as a child
 * process with the same arguments, and starts it again when it exits asking to
 * (RESTART_EXIT, after `wheelhouse plugin` asked it to restart; see
 * cli/running.ts). Signals go to the child, and the child closes when the
 * supervisor goes away.
 */

export const DEFAULT_PORT = 4310;
const HOST = '127.0.0.1';

type Handler = (req: IncomingMessage, res: ServerResponse, next?: () => void) => void;

/** What the web app's runtime leaves on globalThis for the CLI (see src/lib/server/runtime.ts). */
interface RuntimeHolder {
	shutdown?: () => void;
	upgrade?: (req: IncomingMessage, socket: Duplex, head: Buffer) => boolean;
}
const runtimeHolder = () =>
	(globalThis as Record<symbol, RuntimeHolder | undefined>)[Symbol.for('wheelhouse.runtime')];

function parsePort(value: string): number {
	const n = Number(value);
	if (!Number.isInteger(n) || n < 0 || n > 65535) {
		throw new InvalidArgumentError('Port must be a whole number from 0 to 65535.');
	}
	return n;
}

/** The SvelteKit build sits next to the bundled CLI: dist/cli.js → build/handler.js. */
function handlerPath(): string {
	const here = path.dirname(fileURLToPath(import.meta.url));
	return path.resolve(here, '..', 'build', 'handler.js');
}

function openBrowser(url: string): void {
	const [cmd, args] =
		process.platform === 'darwin'
			? ['open', [url]]
			: process.platform === 'win32'
				? ['cmd', ['/c', 'start', '""', url]]
				: ['xdg-open', [url]];
	try {
		const child = spawn(cmd, args as string[], { detached: true, stdio: 'ignore' });
		child.on('error', () => console.log(`Open ${url} in your browser.`));
		child.unref();
	} catch {
		console.log(`Open ${url} in your browser.`);
	}
}

interface OpenOptions {
	firstmate?: string;
	home?: string;
	port: number;
	browser: boolean;
	stateDir?: string;
	tmuxSocket?: string;
	configDir?: string;
	pluginsDir?: string;
	skipPermissions: boolean;
	specModel?: string;
	specEffort?: string;
	reviewModel?: string;
	reviewEffort?: string;
}

function parseEffort(v: string): string {
	if (!['low', 'medium', 'high'].includes(v)) {
		throw new InvalidArgumentError('Use low, medium or high.');
	}
	return v;
}

const SUPERVISED = 'WHEELHOUSE_SUPERVISED';
const RESTARTED = 'WHEELHOUSE_RESTARTED';

/** Run the server as a child process, starting it again each time it exits to restart. */
function supervise(): void {
	let child: ReturnType<typeof spawn>;
	let stopping = false;
	const start = (restarted: boolean) => {
		child = spawn(process.execPath, [...process.execArgv, ...process.argv.slice(1)], {
			stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
			env: { ...process.env, [SUPERVISED]: '1', ...(restarted ? { [RESTARTED]: '1' } : {}) }
		});
		child.on('exit', (code, signal) => {
			if (code === RESTART_EXIT && !stopping) {
				console.log('Restarting Wheelhouse…');
				start(true);
				return;
			}
			process.exit(code ?? (signal ? 1 : 0));
		});
	};
	// Ctrl+C reaches the child from the terminal too; it closes once however many it gets.
	for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
		process.on(sig, () => {
			stopping = true;
			child.kill(sig);
		});
	}
	start(false);
}

async function open(opts: OpenOptions): Promise<void> {
	if (process.env[SUPERVISED] !== '1') return supervise();
	// Not for anything this server starts, such as the Firstmate session.
	const restarted = process.env[RESTARTED] === '1';
	delete process.env[SUPERVISED];
	delete process.env[RESTARTED];
	const resolved = resolveInstall({
		firstmate: opts.firstmate,
		home: opts.home,
		cwd: process.cwd(),
		env: process.env
	});
	if (!resolved.ok) {
		console.error(`wheelhouse: ${resolved.error}`);
		process.exit(1);
	}
	const { install, notes } = resolved;
	for (const n of notes) console.log(n);
	console.log(`Firstmate:  ${install.firstmateDir}`);
	console.log(`Home:       ${install.homeDir}`);

	const compat = await checkCompatibility(install);
	if (compat.compatible) {
		console.log(
			`Scripts:    compatible${compat.firstmateVersion ? ` (Firstmate ${compat.firstmateVersion})` : ''}`
		);
	} else {
		console.warn('Warning: this Firstmate may not be compatible with Wheelhouse:');
		for (const p of compat.problems) console.warn(`  - ${p}`);
		console.warn('Wheelhouse will start and show what it can; see /api/health.');
	}

	const stateDir = opts.stateDir ? path.resolve(opts.stateDir) : defaultStateDir(process.env);
	if (isInside(stateDir, install.homeDir)) {
		console.error(
			`wheelhouse: the state directory ${stateDir} is inside the Firstmate home. Wheelhouse never writes there; pass --state-dir <dir> outside it.`
		);
		process.exit(1);
	}
	console.log(`State:      ${stateDir}`);

	const configDir = opts.configDir ? path.resolve(opts.configDir) : defaultConfigDir(process.env);
	if (isInside(configDir, install.homeDir)) {
		console.error(
			`wheelhouse: the config directory ${configDir} is inside the Firstmate home. Wheelhouse never reads its own config from there; pass --config-dir <dir> outside it.`
		);
		process.exit(1);
	}
	console.log(`Config:     ${configDir}`);

	const file = handlerPath();
	if (!existsSync(file)) {
		console.error(
			`wheelhouse: the web app is not built (${file} is missing). Run \`npm run build\`.`
		);
		process.exit(1);
	}
	process.env.WHEELHOUSE_FIRSTMATE_DIR = install.firstmateDir;
	process.env.WHEELHOUSE_HOME = install.homeDir;
	process.env.WHEELHOUSE_STATE_DIR = stateDir;
	process.env.WHEELHOUSE_CONFIG_DIR = configDir;
	if (opts.pluginsDir) process.env.WHEELHOUSE_PLUGINS_DIR = path.resolve(opts.pluginsDir);
	process.env.WHEELHOUSE_BUNDLED_PLUGINS_DIR = path.resolve(path.dirname(file), '..', 'plugins');
	if (opts.tmuxSocket) process.env.WHEELHOUSE_TMUX_SOCKET = opts.tmuxSocket;
	process.env.WHEELHOUSE_SKIP_PERMISSIONS = opts.skipPermissions ? '1' : '0';
	if (opts.specModel) process.env.WHEELHOUSE_SPEC_MODEL = opts.specModel;
	if (opts.specEffort) process.env.WHEELHOUSE_SPEC_EFFORT = opts.specEffort;
	if (opts.reviewModel) process.env.WHEELHOUSE_REVIEW_MODEL = opts.reviewModel;
	if (opts.reviewEffort) process.env.WHEELHOUSE_REVIEW_EFFORT = opts.reviewEffort;
	const { handler } = (await import(pathToFileURL(file).href)) as { handler: Handler };

	const token = newToken();
	let close = (_code: number) => {};
	const restart = restartHandler(token, () => close(RESTART_EXIT));
	const server = createServer((req, res) => {
		if (!restart(req, res)) handler(req, res);
	});
	// The terminal drawer is a WebSocket, which SvelteKit's handler never sees.
	server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
		if (runtimeHolder()?.upgrade?.(req, socket, head)) return;
		socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
	});
	await new Promise<void>((resolve) => {
		server.once('error', (err: NodeJS.ErrnoException) => {
			if (err.code === 'EADDRINUSE') {
				console.error(
					`wheelhouse: port ${opts.port} on ${HOST} is already in use. Pass --port <n> to pick another.`
				);
			} else {
				console.error(`wheelhouse: could not start the server: ${err.message}`);
			}
			process.exit(1);
		});
		server.listen(opts.port, HOST, () => resolve());
	});
	const address = server.address();
	const port = typeof address === 'object' && address ? address.port : opts.port;
	const url = `http://${HOST}:${port}/`;
	console.log(`Wheelhouse is listening on ${url}`);
	console.log('Press Ctrl+C to close Wheelhouse. Firstmate and its crew keep running.');
	// Starting Firstmate happens in the server's runtime, which reports it on its own line.
	if (opts.browser && !restarted) openBrowser(url);
	// So `wheelhouse plugin` can restart this Wheelhouse to load what it changed.
	let running: string | null = null;
	try {
		running = writeRunning(defaultPluginsDir(process.env), { pid: process.pid, url, token });
	} catch (e) {
		console.warn(
			`Warning: plugin changes will not restart Wheelhouse by themselves: ${(e as Error).message}`
		);
	}

	let closing = false;
	close = (code: number) => {
		if (closing) return;
		closing = true;
		if (running) removeRunning(running);
		runtimeHolder()?.shutdown?.();
		server.close(() => {
			if (code !== RESTART_EXIT) {
				console.log('Wheelhouse closed. Firstmate and its crew are still running.');
			}
			process.exit(code);
		});
		server.closeAllConnections();
		setTimeout(() => process.exit(code), 3000).unref();
	};
	process.on('SIGINT', () => close(0));
	process.on('SIGTERM', () => close(0));
	process.on('SIGHUP', () => close(0));
	// The supervisor went away (it was killed), so nothing would start this server again.
	process.on('disconnect', () => close(0));
}

export function program(): Command {
	const cli = new Command('wheelhouse')
		.description('A local companion to Firstmate: watch the crew at work from a web UI.')
		.version(version);

	cli
		.command('open', { isDefault: true })
		.description(
			'Start Wheelhouse, start (or show) the Firstmate session, and open it in the browser.'
		)
		.option('--firstmate <dir>', 'Firstmate code directory (default: the checkout you are in)')
		.option(
			'--home <dir>',
			'Firstmate operational home (default: $FM_HOME, else the code directory)'
		)
		.option('--port <n>', 'port to listen on (127.0.0.1 only)', parsePort, DEFAULT_PORT)
		.option(
			'--state-dir <dir>',
			'where Wheelhouse keeps its own records (default: $WHEELHOUSE_STATE_DIR, else $XDG_STATE_HOME/wheelhouse, else ~/.local/state/wheelhouse)'
		)
		.option(
			'--tmux-socket <name>',
			"the tmux server (tmux -L <name>) the Firstmate session runs on, kept apart from the crew's (default: $WHEELHOUSE_TMUX_SOCKET, else wheelhouse)"
		)
		.option(
			'--config-dir <dir>',
			'the captain-owned Wheelhouse config, with per-project passage files in projects/<id>.yaml (default: $WHEELHOUSE_CONFIG_DIR, else $XDG_CONFIG_HOME/wheelhouse, else ~/.config/wheelhouse)'
		)
		.option(
			'--spec-model <model>',
			"the Claude model the Spec tab's interviewer uses (default: $WHEELHOUSE_SPEC_MODEL, else sonnet)"
		)
		.option(
			'--spec-effort <level>',
			"how hard the Spec tab's interviewer thinks: low, medium or high (default: $WHEELHOUSE_SPEC_EFFORT, else low)",
			parseEffort
		)
		.option(
			'--plugins-dir <dir>',
			'where installed plugins live (default: $WHEELHOUSE_PLUGINS_DIR, else ~/.wheelhouse/plugins)'
		)
		.option('--no-browser', 'do not open the browser')
		.option(
			'--no-skip-permissions',
			'start Firstmate without --dangerously-skip-permissions, so Claude Code asks before tools run (answer in the terminal drawer)'
		)
		.option(
			'--review-model <model>',
			'the model the PR review agent uses (default: $WHEELHOUSE_REVIEW_MODEL, else sonnet)'
		)
		.addOption(
			new Option(
				'--review-effort <level>',
				'how hard the PR review agent thinks (default: $WHEELHOUSE_REVIEW_EFFORT, else low)'
			).choices(['low', 'medium', 'high', 'xhigh', 'max'])
		)
		.action((opts: OpenOptions) => open(opts));
	cli.addCommand(pluginCommand());
	return cli;
}

await program().parseAsync(process.argv);
