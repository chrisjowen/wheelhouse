import { fork, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Command, InvalidArgumentError } from 'commander';
import { version } from '../package.json';
import { DEFAULT_GATEWAY } from '../src/lib/cloud';
import { parseHarness, type Harness } from '../src/lib/harness';
import { resolveHarness, savedAgentForServer, savedHarnessNow } from './harness';
import { UPLOAD_MAX_BYTES } from '../src/lib/chat/attachments';
import { detectHosted, PREVIEW_PROXY_ENV, PREVIEW_URL_ENV } from '../src/lib/hosted';
import { ALLOWED_HOSTS_ENV, parseAllowedHosts } from '../src/lib/server/session';
import { parsePreviewPorts, PREVIEW_PORTS_ENV } from '../src/lib/server/previewproxy';
import { checkCompatibility, resolveInstall } from '../src/lib/server/firstmate/install';
import { cloudKeychain } from '../src/lib/server/cloud/local';
import { CloudService } from '../src/lib/server/cloud/service';
import { cloudDir, CloudSettings } from '../src/lib/server/cloud/settings';
import { defaultConfigDir } from '../src/lib/server/plugins/config';
import {
	FEATURE_FLAGS,
	featureSettings,
	parseFeatureList,
	type FeatureFlag
} from '../src/lib/server/features';
import { defaultPluginsDir } from '../src/lib/server/plugins/installed';
import { readRemembered } from '../src/lib/server/setup/remembered';
import { defaultStateDir, isInside } from '../src/lib/server/store/store';
import {
	parseSessionBackend,
	resolveSessionBackend,
	type SessionBackendName
} from '../src/lib/server/sessions/choice';
import { DEFAULT_HERDR_SESSION, HERDR_SESSION } from '../src/lib/server/sessions/herdr';
import { setRestart } from '../src/lib/server/restart';
import { setAgentToken } from '../src/lib/server/agentauth';
import { takeHandoff } from '../src/lib/server/upgrade/settings';
import { addPluginAgentCommands, agentCommands, defaultAgentDeps } from './agent';
import { pluginCommand } from './plugin';
import { localPreviewPorts, registerOpenGateway, remoteCommand } from './remote';
import { newToken, removeRunning, restartHandler, RESTART_EXIT, writeRunning } from './running';
import { skillsCommand } from './skills';
import { supervise } from './supervise';
import { upgradeCommand } from './upgrade';

/**
 * `wheelhouse open`: find Firstmate, check its integration scripts, start the
 * Wheelhouse server on loopback (or the address --host names) and open the browser. It also starts the one Firstmate session - an interactive `claude` in
 * Firstmate's checkout, inside a tmux session on tmux's default server
 * (or, with `--session-backend herdr`, experimentally, in a pane of a
 * named herdr session) - when no Firstmate session is running; when one already holds Firstmate's
 * session lock, it shows that one instead and never starts a second. The home
 * page is the conversation with it. Wheelhouse never stops Firstmate: closing
 * it leaves Firstmate's session and its crew running. Wheelhouse keeps its own
 * records in a state directory outside the Firstmate home.
 *
 * With no Firstmate to be found (no --firstmate, none above the folder it runs
 * in, none the setup wizard remembered), it starts anyway and the pages open
 * the setup wizard (src/lib/server/setup/), which clones or finds one.
 *
 * The server itself runs in a child process (the hidden `__server` command)
 * under a small watcher (cli/supervise.ts) that restarts it on the same port
 * if it dies, so open pages reconnect on their own. A restarted server never
 * starts a Firstmate session (WHEELHOUSE_RESTARTED): the watcher is about
 * Wheelhouse only. It also starts the server again when it exits asking to
 * (RESTART_EXIT, after `wheelhouse plugin` or `wheelhouse upgrade` asked it to
 * restart, see cli/running.ts, or a page upgraded Wheelhouse or changed a plugin,
 * see src/lib/server/restart.ts), on the same port, so `--port 0` keeps its address.
 *
 * The watcher also runs Wheelhouse Cloud's connector (cli/remote.ts), but only
 * while the experimental `remotes` feature is enabled (src/lib/server/features.ts)
 * and once the captain starts remote access on the Remotes page (and while this
 * machine is paired), so the connection to the gateway outlives a server
 * restart. Opening Wheelhouse never starts it: a Start left on resumes when
 * Wheelhouse opens again, until the captain stops it.
 */

export const DEFAULT_PORT = 4310;
/** Where Wheelhouse listens unless WHEELHOUSE_HOST (--host) says otherwise, and the address it is opened at. */
const HOST = '127.0.0.1';
export const HOST_ENV = 'WHEELHOUSE_HOST';

/** The addresses Wheelhouse may listen on: loopback (the default), or every interface for a cloud IDE's forward. */
const BIND_ADDRESSES = ['127.0.0.1', '::1', '0.0.0.0', '::'];

function parseHost(value: string): string {
	const v = value.trim().replace(/^\[(.*)\]$/, '$1');
	if (!BIND_ADDRESSES.includes(v)) {
		throw new InvalidArgumentError(
			'Wheelhouse listens on 127.0.0.1 (the default), ::1, or every interface: 0.0.0.0 or ::.'
		);
	}
	return v;
}

/** The address the server listens on: WHEELHOUSE_HOST (--host), else 127.0.0.1; throws when it may not. */
export const bindAddress = (env: Record<string, string | undefined>): string =>
	parseHost(env[HOST_ENV]?.trim() || HOST);

/** Whether binding `host` keeps Wheelhouse on this computer only. */
const loopbackBind = (host: string) => host === '127.0.0.1' || host === '::1';

/** The address this computer opens Wheelhouse at, which every address it may listen on answers. */
const openHost = (bind: string) => (bind === '::1' ? '[::1]' : HOST);

function parseAllowedHostsOption(value: string): string {
	const { invalid } = parseAllowedHosts(value);
	if (invalid.length) {
		throw new InvalidArgumentError(
			`Not a host name or *.suffix: ${invalid.join(', ')}. Give host names, such as ide.example.dev, or suffixes such as *.example.dev.`
		);
	}
	return value;
}

function parseOnOff(value: string): 'on' | 'off' {
	const v = value.trim().toLowerCase();
	if (v !== 'on' && v !== 'off') throw new InvalidArgumentError('Give on or off.');
	return v;
}

function parsePortsOption(value: string): string {
	const { invalid } = parsePreviewPorts(value);
	if (invalid.length) throw new InvalidArgumentError(`Not a port: ${invalid.join(', ')}.`);
	return value;
}

type Handler = (req: IncomingMessage, res: ServerResponse, next?: () => void) => void;

/** What the web app's runtime leaves on globalThis for the CLI (see src/lib/server/runtime.ts). */
interface RuntimeHolder {
	shutdown?: () => void;
	busy?: () => Promise<string[]>;
	upgrade?: (req: IncomingMessage, socket: Duplex, head: Buffer) => boolean;
	request?: (req: IncomingMessage, res: ServerResponse) => boolean;
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
	harness?: Harness;
	firstmate?: string;
	home?: string;
	port: number;
	browser: boolean;
	stateDir?: string;
	tmuxSocket?: string;
	sessionBackend?: SessionBackendName;
	herdrSession?: string;
	configDir?: string;
	pluginsDir?: string;
	previewUrl?: string;
	host?: string;
	allowedHosts?: string;
	previewProxy?: 'on' | 'off';
	previewPorts?: string;
	gateway?: string;
	skipPermissions: boolean;
	enable?: FeatureFlag[];
}

async function open(opts: OpenOptions): Promise<void> {
	const configDir = opts.configDir ? path.resolve(opts.configDir) : defaultConfigDir(process.env);
	const stateDir = opts.stateDir ? path.resolve(opts.stateDir) : defaultStateDir(process.env);
	const resolved = resolveInstall({
		firstmate: opts.firstmate,
		home: opts.home,
		cwd: process.cwd(),
		env: process.env,
		remembered: readRemembered(configDir)
	});
	// Nothing named a Firstmate and none was found: open the setup wizard instead of failing.
	const setup = !resolved.ok && resolved.missing;
	if (!resolved.ok && !setup) {
		console.error(`wheelhouse: ${resolved.error}`);
		process.exit(1);
	}
	if (resolved.ok) {
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

		if (isInside(stateDir, install.homeDir)) {
			console.error(
				`wheelhouse: the state directory ${stateDir} is inside the Firstmate home. Wheelhouse never writes there; pass --state-dir <dir> outside it.`
			);
			process.exit(1);
		}
		if (isInside(configDir, install.homeDir)) {
			console.error(
				`wheelhouse: the config directory ${configDir} is inside the Firstmate home. Wheelhouse never reads its own config from there; pass --config-dir <dir> outside it.`
			);
			process.exit(1);
		}
		// One the setup wizard remembered is found again by the server from the same record,
		// so a restart after the wizard switches Firstmate picks up the new one.
		if (resolved.source !== 'remembered') {
			process.env.WHEELHOUSE_FIRSTMATE_DIR = install.firstmateDir;
			process.env.WHEELHOUSE_HOME = install.homeDir;
		} else if (opts.home) {
			process.env.WHEELHOUSE_HOME = install.homeDir;
		}
	} else {
		console.log(`Firstmate:  not found. ${resolved.error}`);
		console.log('Setup:      the page opens the setup wizard to clone or choose one.');
	}
	console.log(`State:      ${stateDir}`);
	console.log(`Config:     ${configDir}`);
	if (opts.enable?.length) {
		const enabled = parseFeatureList(process.env.WHEELHOUSE_ENABLE_FEATURES ?? '');
		process.env.WHEELHOUSE_ENABLE_FEATURES = [...new Set([...enabled, ...opts.enable])].join(',');
	}
	const featureState = await featureSettings(process.env, configDir);
	const enabledFeatures = Object.entries(featureState)
		.filter(([, on]) => on)
		.map(([name]) => name);
	if (enabledFeatures.length) console.log(`Features:   ${enabledFeatures.join(', ')}`);
	// The flag beats the variable; the server decides the rest the same way (sessions/choice.ts).
	if (opts.sessionBackend) process.env.WHEELHOUSE_SESSION_BACKEND = opts.sessionBackend;
	if (opts.herdrSession) process.env.WHEELHOUSE_HERDR_SESSION = opts.herdrSession;
	const session = resolveSessionBackend({
		env: process.env,
		configDir,
		homeDir: resolved.ok ? resolved.install.homeDir : null
	});
	if (session.error) {
		console.error(`wheelhouse: ${session.error}`);
		process.exit(1);
	}
	if (session.backend === 'herdr') {
		console.log(
			`Session:    herdr (experimental), session ${session.herdrSession || DEFAULT_HERDR_SESSION}`
		);
	}
	if (session.warning) console.warn(`Warning: ${session.warning}`);
	// Where it listens, and the cloud IDE settings (a forward's Host, the preview proxy): the
	// flags beat the variables, which the server reads.
	if (opts.host !== undefined) process.env[HOST_ENV] = opts.host;
	let bind = HOST;
	try {
		bind = bindAddress(process.env);
	} catch (e) {
		console.error(`wheelhouse: ${HOST_ENV}: ${(e as Error).message}`);
		process.exit(1);
	}
	process.env[HOST_ENV] = bind;
	if (!loopbackBind(bind)) {
		console.warn(
			`Warning: Wheelhouse listens on ${bind}, not only on this computer. Anyone who can reach its port can use it; do this only where the network is private to you (a cloud IDE's environment).`
		);
	}
	if (opts.allowedHosts !== undefined) process.env[ALLOWED_HOSTS_ENV] = opts.allowedHosts;
	const allowed = parseAllowedHosts(process.env[ALLOWED_HOSTS_ENV]);
	if (allowed.invalid.length) {
		console.warn(
			`Warning: ${ALLOWED_HOSTS_ENV} names ${allowed.invalid.join(', ')}, which ${allowed.invalid.length === 1 ? 'is not a host name or *.suffix' : 'are not host names or *.suffixes'}; ignored.`
		);
	}
	const hosts = [...allowed.exact, ...allowed.suffixes.map((s) => `*${s}`)];
	if (hosts.length) console.log(`Hosts:      loopback, ${hosts.join(', ')}`);
	if (opts.previewProxy !== undefined) process.env[PREVIEW_PROXY_ENV] = opts.previewProxy;
	if (opts.previewPorts !== undefined) process.env[PREVIEW_PORTS_ENV] = opts.previewPorts;
	// A hosted dev environment's preview URLs (lib/hosted.ts): the server reads the same variable.
	if (opts.previewUrl !== undefined) process.env[PREVIEW_URL_ENV] = opts.previewUrl;
	const hosted = detectHosted(process.env);
	if (hosted.problem) console.warn(`Warning: ${hosted.problem}`);
	if (hosted.hosted) {
		console.log(`Previews:   ${hosted.hosted.pattern} (${hosted.hosted.source})`);
	}

	// A tool named by the flag or the variable is fixed; otherwise the setup wizard may change it.
	const harnessFixed = opts.harness !== undefined || process.env.WHEELHOUSE_HARNESS !== undefined;
	process.env.WHEELHOUSE_HARNESS_FIXED = harnessFixed ? '1' : '0';
	process.env.WHEELHOUSE_HARNESS = await resolveHarness({
		explicit: opts.harness,
		env: process.env,
		configDir
	});
	const file = handlerPath();
	if (!existsSync(file)) {
		console.error(
			`wheelhouse: the web app is not built (${file} is missing). Run \`npm run build\`.`
		);
		process.exit(1);
	}
	process.env.WHEELHOUSE_STATE_DIR = stateDir;
	process.env.WHEELHOUSE_CONFIG_DIR = configDir;
	if (opts.pluginsDir) process.env.WHEELHOUSE_PLUGINS_DIR = path.resolve(opts.pluginsDir);
	process.env.WHEELHOUSE_BUNDLED_PLUGINS_DIR = path.resolve(path.dirname(file), '..', 'plugins');
	// Where `wheelhouse upgrade` (and the header's Upgrade) find the clone to update.
	process.env.WHEELHOUSE_INSTALL_DIR = path.resolve(path.dirname(file), '..');
	if (opts.tmuxSocket) process.env.WHEELHOUSE_TMUX_SOCKET = opts.tmuxSocket;
	process.env.WHEELHOUSE_SKIP_PERMISSIONS = opts.skipPermissions ? '1' : '0';

	let cli = fileURLToPath(import.meta.url);
	let serverPort = opts.port;
	// Off until the Remotes feature is enabled and remote access is started.
	if (opts.gateway !== undefined && !featureState.remotes) {
		console.error(
			'wheelhouse: remote features are disabled. Enable Remotes in Settings → Experimental features or use --enable remotes.'
		);
		process.exit(1);
	}
	const cloudSettings = new CloudSettings(cloudDir(configDir), cloudKeychain());
	if (opts.gateway !== undefined) {
		const registration = await registerOpenGateway(cloudSettings, opts.gateway);
		if (!registration.ok) {
			console.error(`wheelhouse: ${registration.error}`);
			process.exit(1);
		}
	}
	const cloud = new CloudService({
		settings: cloudSettings,
		version,
		appPort: () => serverPort,
		previewPorts: localPreviewPorts(() => serverPort),
		log: (line) => console.warn(line)
	});
	const watcher = supervise({
		port: opts.port,
		start: (port, restart) => {
			// A source switch leaves the install to restart into (the global npm package or a clone).
			const next = takeHandoff(configDir);
			if (next && restart) {
				cli = path.join(next, 'dist', 'cli.js');
				process.env.WHEELHOUSE_INSTALL_DIR = next;
				process.env.WHEELHOUSE_BUNDLED_PLUGINS_DIR = path.join(next, 'plugins');
				console.log(`Wheelhouse now runs from ${next}.`);
			}
			// The setup wizard may have chosen another agent: a restart starts with it.
			// The server reads that choice too (serve), for a launcher that does not.
			const saved = restart && !harnessFixed ? savedHarnessNow(configDir) : null;
			if (saved) process.env.WHEELHOUSE_HARNESS = saved;
			const child = fork(cli, ['__server', '--port', String(port)], {
				env: { ...process.env, WHEELHOUSE_RESTARTED: restart ? '1' : '0' },
				stdio: ['ignore', 'inherit', 'inherit', 'ipc']
			});
			child.on('message', (message) => {
				if (
					typeof message !== 'object' ||
					message === null ||
					(message as { type?: unknown }).type !== 'features-changed'
				)
					return;
				void featureSettings(process.env, configDir).then((flags) =>
					flags.remotes ? cloud.start() : cloud.stop()
				);
			});
			return child;
		},
		onReady: (port) => {
			serverPort = port;
			void featureSettings(process.env, configDir).then((flags) =>
				flags.remotes ? cloud.start() : cloud.stop()
			);
			const url = `http://${openHost(bind)}:${port}/${setup ? 'setup' : ''}`;
			console.log(`Wheelhouse is listening on ${url}`);
			console.log('Press Ctrl+C to close Wheelhouse. Firstmate and its crew keep running.');
			// Starting Firstmate happens in the server's runtime, which reports it on its own line.
			if (opts.browser) openBrowser(url);
		},
		log: (line) => console.warn(line)
	});
	process.on('SIGINT', watcher.stop);
	process.on('SIGTERM', watcher.stop);
	const code = await watcher.done;
	await cloud.stop();
	process.exit(code);
}

/**
 * `wheelhouse __server`: the server itself, started by `open` with the
 * WHEELHOUSE_* environment already resolved. Tells its watcher when it is
 * listening, and closes when asked (exit 0) or when the watcher is gone.
 */
async function serve(opts: { port: number }): Promise<void> {
	// An older launcher restarts this process with the agent it resolved when it
	// started. Unless a flag or variable fixed that agent, the saved choice wins.
	const savedAgent = savedAgentForServer(process.env, defaultConfigDir(process.env));
	if (savedAgent) process.env.WHEELHOUSE_HARNESS = savedAgent;
	// Where the bundled skill comes from: the runtime installs it, saying which review surface is on.
	process.env.WHEELHOUSE_INSTALL_DIR = path.resolve(path.dirname(handlerPath()), '..');
	// Where it listens (`open` checked it), and where the gateway's "Open in Wheelhouse" links point.
	const bind = bindAddress(process.env);
	process.env.WHEELHOUSE_URL = `http://${openHost(bind)}:${opts.port}`;
	// adapter-node refuses request bodies over 512 KB by default; a chat attachment may be up to
	// UPLOAD_MAX_BYTES (each route still caps its own body).
	process.env.BODY_SIZE_LIMIT ??= String(UPLOAD_MAX_BYTES + 64 * 1024);
	const { handler } = (await import(pathToFileURL(handlerPath()).href)) as { handler: Handler };

	const token = newToken();
	// The same token opens the routes agents may change through (`wheelhouse status`, `passage`, …).
	setAgentToken(token);
	let close = (_code: number) => {};
	const restart = restartHandler(
		token,
		() => close(RESTART_EXIT),
		async () => (await runtimeHolder()?.busy?.()) ?? []
	);
	// Requests for *.localhost names go to plugins' host routes, never to SvelteKit's handler.
	const server = createServer((req, res) => {
		if (!restart(req, res) && !runtimeHolder()?.request?.(req, res)) handler(req, res);
	});
	// So an upgrade or plugin change made from a page can restart this server too.
	setRestart(() => close(RESTART_EXIT));
	// The terminal drawer and plugins' host routes take WebSockets, which SvelteKit's handler never sees.
	server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
		if (runtimeHolder()?.upgrade?.(req, socket, head)) return;
		socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
	});
	await new Promise<void>((resolve) => {
		server.once('error', (err: NodeJS.ErrnoException) => {
			if (err.code === 'EADDRINUSE') {
				console.error(
					`wheelhouse: port ${opts.port} on ${bind} is already in use, perhaps by another Wheelhouse. Pass --port <n> to pick another.`
				);
			} else {
				console.error(`wheelhouse: could not start the server: ${err.message}`);
			}
			process.exit(1);
		});
		server.listen(opts.port, bind, () => resolve());
	});
	const address = server.address();
	const port = typeof address === 'object' && address ? address.port : opts.port;
	const url = `http://${openHost(bind)}:${port}/`;
	// So `wheelhouse plugin` can restart this Wheelhouse to load what it changed.
	let running: string | null = null;
	try {
		running = writeRunning(defaultPluginsDir(process.env), { pid: process.pid, url, token });
	} catch (e) {
		console.warn(
			`Warning: plugin changes will not restart Wheelhouse by themselves: ${(e as Error).message}`
		);
	}
	process.send?.({ type: 'ready', port });

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
	// The watcher is gone (killed outright): close rather than serve unwatched.
	process.on('disconnect', () => close(0));
}

export function program(): Command {
	const cli = new Command('wheelhouse')
		.description('A local companion to Firstmate: watch the crew at work from a web UI.')
		.version(version);

	cli
		.command('open', { isDefault: true })
		.description(
			'Start Wheelhouse, start (or show) the Firstmate session, and open it in the browser; with no Firstmate yet, open the setup wizard.'
		)
		.option(
			'--firstmate <dir>',
			'Firstmate code directory (default: the checkout you are in, else the one setup remembered; with none, the page opens the setup wizard)'
		)
		.option(
			'--home <dir>',
			'Firstmate operational home (default: $FM_HOME, else the one setup remembered, else the code directory)'
		)
		.option('--port <n>', 'port to listen on', parsePort, DEFAULT_PORT)
		.option(
			'--host <address>',
			`the address to listen on: 127.0.0.1, ::1, or 0.0.0.0 or :: (every interface) for a cloud IDE (Ona, Codespaces) that forwards only such listeners, where anyone who can reach the port can use Wheelhouse (default: $${HOST_ENV}, else ${HOST})`,
			parseHost
		)
		.option(
			'--allowed-hosts <hosts>',
			`Host names Wheelhouse answers besides loopback, comma-separated, each exact or *.suffix, such as *.example.dev for a cloud IDE's port forward; their pages are served at https://<host> (http:// when X-Forwarded-Proto says so) (default: $${ALLOWED_HOSTS_ENV}, else none)`,
			parseAllowedHostsOption
		)
		.option(
			'--preview-proxy <on|off>',
			`serve each preview port at /_p/<port>/ on Wheelhouse's own address (HTTP and WebSockets, sandboxed, X-Frame-Options dropped), for a cloud IDE that frames only Wheelhouse; only ports Wheelhouse shows or --preview-ports names, never its own (default: $${PREVIEW_PROXY_ENV}, else off)`,
			parseOnOff
		)
		.option(
			'--preview-ports <ports>',
			`more ports the preview proxy may serve, comma-separated (default: $${PREVIEW_PORTS_ENV}, else none)`,
			parsePortsOption
		)
		.option(
			'--state-dir <dir>',
			'where Wheelhouse keeps its own records (default: $WHEELHOUSE_STATE_DIR, else $XDG_STATE_HOME/wheelhouse, else ~/.local/state/wheelhouse)'
		)
		.option(
			'--tmux-socket <name>',
			"a tmux server of its own (tmux -L <name>) for the Firstmate session (default: $WHEELHOUSE_TMUX_SOCKET, else tmux's default server, which the crew share)"
		)
		.option(
			'--session-backend <name>',
			"what runs the Firstmate session: tmux, or herdr (experimental) (default: $WHEELHOUSE_SESSION_BACKEND, else the setup wizard's choice, else herdr when Firstmate's config/backend is herdr, else tmux)",
			(value: string) => {
				try {
					return parseSessionBackend(value);
				} catch (e) {
					throw new InvalidArgumentError(e instanceof Error ? e.message : String(e));
				}
			}
		)
		.option(
			'--herdr-session <name>',
			`the herdr session the Firstmate session runs in with the herdr backend (default: $WHEELHOUSE_HERDR_SESSION, else ${DEFAULT_HERDR_SESSION})`,
			(value: string) => {
				if (!HERDR_SESSION.test(value)) {
					throw new InvalidArgumentError(
						"A herdr session name is letters, digits, '_' or '-' (at most 64)."
					);
				}
				return value;
			}
		)
		.option(
			'--config-dir <dir>',
			'the captain-owned Wheelhouse config, with per-project passage files in projects/<id>.yaml (default: $WHEELHOUSE_CONFIG_DIR, else $XDG_CONFIG_HOME/wheelhouse, else ~/.config/wheelhouse)'
		)
		.option(
			'--plugins-dir <dir>',
			'where installed plugins live (default: $WHEELHOUSE_PLUGINS_DIR, else ~/.wheelhouse/plugins)'
		)
		.option(
			'--preview-url <pattern>',
			`where a hosted dev environment serves this computer's ports, with {port} once, such as https://{port}.example.dev, or a path on Wheelhouse's own address such as /_p/{port}; previews and links to addresses on this computer open there ("off" turns it off; default: $${PREVIEW_URL_ENV}, else /_p/{port} with the preview proxy on, else Gitpod's or Codespaces' own, detected)`
		)
		.option('--no-browser', 'do not open the browser')
		.option(
			'--enable <features>',
			`enable experimental features for this launch: ${FEATURE_FLAGS.join(', ')}`,
			(value: string) => {
				try {
					return parseFeatureList(value);
				} catch (e) {
					throw new InvalidArgumentError(e instanceof Error ? e.message : String(e));
				}
			}
		)
		.option(
			'--gateway <url>',
			`register this Wheelhouse with a Gateway (default: the saved profile, else ${DEFAULT_GATEWAY}; requires Remotes enabled)`
		)
		.option(
			'--harness <name>',
			'Firstmate tool: claude, codex, opencode, pi, grok (default: environment, saved choice, or interactive picker; noninteractive fallback: claude)',
			(value: string) => {
				try {
					return parseHarness(value);
				} catch (e) {
					throw new InvalidArgumentError(e instanceof Error ? e.message : String(e));
				}
			}
		)
		.option(
			'--no-skip-permissions',
			'start Firstmate without --dangerously-skip-permissions, so Claude Code asks before tools run (answer in the terminal drawer)'
		)
		.action((opts: OpenOptions) => open(opts));
	cli
		.command('__server', { hidden: true })
		.description("Wheelhouse's server, as `open` starts it under its watcher.")
		.option('--port <n>', 'port to listen on', parsePort, DEFAULT_PORT)
		.action((opts: { port: number }) => serve(opts));
	const agent = defaultAgentDeps();
	cli.addCommand(addPluginAgentCommands(pluginCommand(), agent));
	cli.addCommand(upgradeCommand({ agent }));
	cli.addCommand(remoteCommand());
	cli.addCommand(skillsCommand());
	for (const c of agentCommands(agent)) cli.addCommand(c);
	return cli;
}
