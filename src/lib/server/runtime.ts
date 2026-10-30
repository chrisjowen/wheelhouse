import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { version } from '../../../package.json';
import { createScriptAdapter, type FirstmateAdapter } from './firstmate/adapter';
import { EvidenceReader } from './firstmate/evidence';
import { killAllRunning } from './firstmate/exec';
import {
	checkCompatibility,
	MESSAGING_PURPOSE,
	resolveInstall,
	type Compatibility,
	type FirstmateInstall
} from './firstmate/install';
import { LedgerReader } from './firstmate/ledger';
import { parseProjectsRegistry, UNASSIGNED } from './firstmate/model';
import { Collector } from './collector/collector';
import { ShipsBell } from './bell/bell';
import { InsightsService } from './insights/service';
import { InboxService } from './inbox/service';
import {
	IssueWatcher,
	WATCH_PLUGIN,
	WATCH_PROVIDER,
	watchFileFor,
	WatchStore
} from './issues/watch';
import { BuildReader } from './buildlog/reader';
import { usableRoots, type FileRoots } from './files/docfile';
import { reviewAgentConfig } from './prreview/config';
import { ReviewService } from './prreview/service';
import { BUILTIN_PLUGINS } from './plugins/builtin';
import { defaultConfigDir, PLUGINS_FILE, PluginConfigFile } from './plugins/config';
import { defaultPluginsDir } from './plugins/installed';
import {
	bundledPluginsDir,
	loadBundledPlugins,
	loadInstalledPlugins,
	uiFile
} from './plugins/loader';
import { PluginRegistry } from './plugins/registry';
import { ServicePorts } from './plugins/ports';
import { launchable, ServiceManager } from './plugins/services';
import { AppHost } from './apps/host';
import { Sandboxes } from './apps/sandbox';
import { parseSlotKey, type SlotKey, type SlotQuery } from '../plugins/keys';
import { defaultDeps } from './passages/checks';
import { ConsentStore, consentFileFor } from './passages/consent';
import { ReachedStore, reachedFileFor } from './passages/reached';
import { PassageService } from './passages/service';
import { Messenger } from './store/messenger';
import { FirstmateSession, firstmateTmux, type LockState } from './sessions/firstmate';
import { refuseUpgrade, TerminalServer, isTerminalUrl } from './sessions/terminal';
import { ChatFeed, locateTranscript, projectsDir } from './sessions/transcript';
import { defaultStateDir, isInside, MessageStore, storeFileFor } from './store/store';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import type {
	DecisionsView,
	FirstmateSessionView,
	FleetView,
	Health,
	HeadroomView,
	MessagesView,
	RailInsights,
	TimeView
} from '../types';
import type { PluginsView, ServiceView, SlotView } from '../plugins/types';
import type { InboxView } from '../inbox';

/**
 * Process-wide wiring: one adapter, one collector, one evidence reader, one
 * messenger, one plugin registry and one session manager. The CLI passes the
 * resolved Firstmate paths through WHEELHOUSE_FIRSTMATE_DIR and WHEELHOUSE_HOME,
 * and the message store's directory through WHEELHOUSE_STATE_DIR; the plugins
 * file is read from the config directory (see defaultConfigDir). In development
 * the same variables can be set by hand. WHEELHOUSE_TMUX_SOCKET (--tmux-socket)
 * names the tmux server the Firstmate session runs on, which the runtime starts
 * when none is running, and WHEELHOUSE_SKIP_PERMISSIONS=0 (--no-skip-permissions) starts it without
 * --dangerously-skip-permissions. WHEELHOUSE_RESTARTED=1 (a server the CLI's
 * watcher restarted) starts no session at all.
 * Stored on globalThis so Vite's module reloading does not start a second
 * collector, so the CLI can shut it down, and so the HTTP server (the CLI's,
 * or Vite's in development) can hand WebSocket upgrades for the terminal drawer
 * to `upgrade`, which SvelteKit's request handler never sees.
 */

export type Runtime =
	| {
			configured: true;
			install: FirstmateInstall;
			adapter: FirstmateAdapter;
			collector: Collector;
			bell: ShipsBell;
			evidence: EvidenceReader;
			messenger: Messenger | null;
			plugins: PluginRegistry;
			/** Plugin companion services; null when the state directory cannot hold their logs. */
			services: ServiceManager | null;
			/** MCP apps: the host that talks to plugins' MCP servers, and the sandbox they render in. */
			apps: AppHost;
			sandbox: Sandboxes;
			firstmate: FirstmateSession;
			chat: ChatFeed;
			terminals: TerminalServer;
			passages: PassageService;
			insights: InsightsService;
			build: BuildReader;
			inbox: InboxService;
			review: ReviewService;
	  }
	| { configured: false; error: string };

interface RuntimeHolder {
	runtime: Promise<Runtime> | null;
	shutdown: () => void;
	busy: () => Promise<string[]>;
	upgrade: (req: IncomingMessage, socket: Duplex, head: Buffer) => boolean;
}

const KEY = Symbol.for('wheelhouse.runtime');
const g = globalThis as unknown as Record<symbol, RuntimeHolder | undefined>;

async function create(env: NodeJS.ProcessEnv): Promise<Runtime> {
	const resolved = resolveInstall({
		firstmate: env.WHEELHOUSE_FIRSTMATE_DIR || undefined,
		home: env.WHEELHOUSE_HOME || undefined,
		cwd: process.cwd(),
		env
	});
	if (!resolved.ok) return { configured: false, error: resolved.error };
	const install = resolved.install;
	const compatibility = await checkCompatibility(install);
	// Firstmate's scripts reach its session's tmux server however Wheelhouse itself was launched.
	const adapter = createScriptAdapter(install, {
		tmux: firstmateTmux({ tmuxSocket: env.WHEELHOUSE_TMUX_SOCKET || null, env })
	});
	const evidence = new EvidenceReader({
		dataDir: path.join(install.homeDir, 'data'),
		useGh: env.WHEELHOUSE_NO_GH !== '1',
		evidenceDir: env.WHEELHOUSE_NM_EVIDENCE_DIR || undefined,
		logsDir: env.WHEELHOUSE_NM_LOGS_DIR || undefined
	});
	const insights = createInsights(install, env);
	const build = new BuildReader({
		homeDir: install.homeDir,
		evidence,
		logsDir: env.WHEELHOUSE_NM_LOGS_DIR || path.join(env.HOME ?? '', '.no-mistakes', 'logs'),
		claudeProjectsDir: env.WHEELHOUSE_NO_USAGE === '1' ? null : projectsDir(env),
		env,
		useGh: env.WHEELHOUSE_NO_GH !== '1'
	});
	// The collector is made below; a change request is only routed once it exists.
	const messaging = await createMessenger(install, compatibility, adapter, env, (id) =>
		collector.changeRoute(id)
	);
	const passages = await createPassages(install, env);
	const bell = new ShipsBell();
	const collector = new Collector({
		adapter,
		compatibility,
		install,
		version,
		evidence,
		ledger: new LedgerReader(path.join(install.homeDir, 'state', 'fleet-ledger.jsonl')),
		registry: async (dataDir) =>
			parseProjectsRegistry(await readFile(path.join(dataDir, 'projects.md'), 'utf8')),
		messenger: messaging.messenger,
		messagingUnavailable: messaging.reason ?? undefined,
		passages,
		insights,
		build,
		bell
	});
	collector.start();
	const inbox = new InboxService({
		sources: () => ({
			tasks: collector.getFleet().tasks,
			row: (id) => collector.row(id),
			backlog: (id) => collector.backlog(id),
			ledger: (id) => collector.ledgerTask(id),
			messages: messaging.messenger?.view().messages ?? [],
			homeDir: install.homeDir
		}),
		dataDir: () => collector.dataDirectory(),
		messenger: messaging.messenger,
		unavailable: () => collector.health().messaging.reason
	});
	const pluginsFile = new PluginConfigFile(path.join(defaultConfigDir(env), PLUGINS_FILE));
	// Launch logs and service ports live in Wheelhouse's own state directory, never in the Firstmate home.
	const serviceState = defaultStateDir(env);
	const serviceStateOk = !isInside(serviceState, install.homeDir);
	// Bundled and installed plugins load once, at startup; `wheelhouse plugin` restarts a running Wheelhouse to load a change (cli/running.ts).
	const pluginsDir = defaultPluginsDir(env);
	const [bundled, installed] = await Promise.all([
		loadBundledPlugins(bundledPluginsDir(env)),
		loadInstalledPlugins(pluginsDir)
	]);
	const problems = [...bundled.problems, ...installed.problems];
	for (const p of problems) if (p.state === 'failed') console.warn(p.reason);
	if (bundled.error) console.warn(`Bundled plugins: ${bundled.error}`);
	if (installed.error) console.warn(`Installed plugins: ${installed.error}`);
	const plugins = new PluginRegistry(
		BUILTIN_PLUGINS,
		{
			fleet: () => collector.getFleet(),
			worktree: (id) => collector.row(id)?.worktree.path ?? null,
			home: () => install.homeDir,
			changedFiles: async (id) => {
				const wt = collector.row(id)?.worktree;
				if (!wt?.present) return null;
				const d = await evidence.diff(wt.path);
				return d.available ? d.value.files.map((f) => f.path) : null;
			},
			config: () => pluginsFile.current(),
			configFile: pluginsFile.file,
			servicePorts: serviceStateOk
				? new ServicePorts(
						path.join(
							path.dirname(storeFileFor(serviceState, install.homeDir)),
							'service-ports.json'
						)
					)
				: null,
			env
		},
		{
			dir: pluginsDir,
			plugins: [...bundled.installed, ...installed.installed],
			problems,
			error: installed.error
		}
	);
	void watchIssues(
		new IssueWatcher({
			read: () => plugins.builtinFleetValue(WATCH_PLUGIN, WATCH_PROVIDER),
			settings: async () =>
				(await pluginsFile.current()).config.plugins[WATCH_PLUGIN]?.settings ?? {},
			ring: (draft) => bell.ring(draft),
			send: messaging.messenger ? (input) => messaging.messenger!.send(input) : null,
			// Kept per home, beside its message store; in memory only when the state directory is refused.
			store: serviceStateOk
				? await WatchStore.open(watchFileFor(serviceState, install.homeDir))
				: WatchStore.memory(),
			log: (m) => console.warn(m)
		}),
		() => !!collector.getFleet().collectedAt
	);
	const services = serviceStateOk
		? new ServiceManager({ logDir: path.join(serviceState, 'services'), env })
		: null;
	// MCP apps render on loopback origins of their own, one for each MCP server.
	const sandbox = new Sandboxes();
	const apps = new AppHost({
		registry: plugins,
		serviceView: (q) => serviceView(plugins, services, q),
		sandbox: (key, csp) => sandbox.url(key, csp),
		version
	});
	const firstmate = new FirstmateSession({
		firstmateDir: install.firstmateDir,
		homeDir: install.homeDir,
		stateDir: defaultStateDir(env),
		lock: () => lockState(adapter),
		skipPermissions: env.WHEELHOUSE_SKIP_PERMISSIONS !== '0',
		tmuxSocket: env.WHEELHOUSE_TMUX_SOCKET || null,
		env
	});
	const chat = new ChatFeed({
		status: () => firstmate.status(),
		locate: (state) =>
			locateTranscript(
				{
					firstmateDir: install.firstmateDir,
					homeDir: install.homeDir,
					hookFile: firstmate.hookFile,
					projectsDir: projectsDir(env)
				},
				state
			)
	});
	const stateDir = defaultStateDir(env);
	const review = new ReviewService({
		homeDir: install.homeDir,
		// Kept per home, beside its message store.
		stateDir: isInside(stateDir, install.homeDir)
			? null
			: path.dirname(storeFileFor(stateDir, install.homeDir)),
		env,
		useGh: env.WHEELHOUSE_NO_GH !== '1',
		agent: reviewAgentConfig(env)
	});
	// A server the CLI's watcher restarted leaves Firstmate as it is (cli/supervise.ts).
	if (env.WHEELHOUSE_RESTARTED === '1') {
		console.log('Firstmate:  left as it is; Wheelhouse only restarted its own server.');
	} else {
		void startFirstmate(firstmate);
	}
	watchSession(firstmate, bell);
	const terminals = new TerminalServer({ resolve: firstmate.terminal });
	return {
		configured: true,
		install,
		adapter,
		collector,
		bell,
		evidence,
		messenger: messaging.messenger,
		plugins,
		services,
		apps,
		sandbox,
		firstmate,
		chat,
		terminals,
		passages,
		insights,
		build,
		inbox,
		review
	};
}

/** How often the issue watcher looks; the plugin's own reads are cached for two minutes. */
const ISSUE_WATCH_MS = 60_000;
let issueWatch: ReturnType<typeof setInterval> | null = null;

/**
 * Look at the watched GitHub issues once a minute, once the collector has read
 * the fleet (before that no project is on, and nothing can be decided).
 */
function watchIssues(watcher: IssueWatcher, ready: () => boolean): void {
	if (issueWatch) clearInterval(issueWatch);
	issueWatch = setInterval(() => {
		if (ready()) void watcher.tick().catch(() => {});
	}, ISSUE_WATCH_MS);
	issueWatch.unref?.();
}

/** How often the ship's bell looks at the Firstmate session for a question waiting on the captain. */
const SESSION_WATCH_MS = 5_000;
let sessionWatch: ReturnType<typeof setInterval> | null = null;

/**
 * Ring the ship's bell when Firstmate's session asks the captain something (a
 * menu on its screen), whether or not a page is showing the chat.
 */
function watchSession(firstmate: FirstmateSession, bell: ShipsBell): void {
	if (sessionWatch) clearInterval(sessionWatch);
	let looking = false;
	sessionWatch = setInterval(() => {
		if (looking) return;
		looking = true;
		void firstmate
			.status()
			.then((view) => bell.observeSession(view))
			.catch(() => {})
			.finally(() => (looking = false));
	}, SESSION_WATCH_MS);
	sessionWatch.unref?.();
}

/**
 * Insights read the no-mistakes run logs (WHEELHOUSE_NM_LOGS_DIR, else
 * ~/.no-mistakes/logs), Claude Code's transcripts for token counts (see
 * projectsDir) and quota-axi. WHEELHOUSE_NO_USAGE=1
 * turns the last two off.
 */
function createInsights(install: FirstmateInstall, env: NodeJS.ProcessEnv): InsightsService {
	const home = env.HOME ?? '';
	const noUsage = env.WHEELHOUSE_NO_USAGE === '1';
	return new InsightsService({
		homeDir: install.homeDir,
		firstmateDir: install.firstmateDir,
		logsDir: env.WHEELHOUSE_NM_LOGS_DIR || path.join(home, '.no-mistakes', 'logs'),
		nmWorktreesDir: path.join(home, '.no-mistakes', 'worktrees'),
		claudeProjectsDir: noUsage ? null : projectsDir(env),
		env,
		readQuota: noUsage
			? async () => ({ ok: false, reason: 'Reading Claude’s limits is turned off.' })
			: undefined
	});
}

/**
 * Passage files: the captain-owned config directory (WHEELHOUSE_CONFIG_DIR,
 * else $XDG_CONFIG_HOME/wheelhouse, else ~/.config/wheelhouse) and the consent
 * and reached-step records in Wheelhouse's state directory. Neither may be inside the Firstmate
 * home: Wheelhouse never reads its configuration from there or writes to it.
 */
async function createPassages(
	install: FirstmateInstall,
	env: NodeJS.ProcessEnv
): Promise<PassageService> {
	let configDir: string | null = defaultConfigDir(env);
	let configProblem: string | null = null;
	if (isInside(configDir, install.homeDir)) {
		configProblem = `The Wheelhouse config directory ${configDir} is inside the Firstmate home, so it is not read; choose one outside it with --config-dir.`;
		configDir = null;
	}
	const stateDir = defaultStateDir(env);
	let consent: ConsentStore | null = null;
	let reached: ReachedStore | null = null;
	let consentProblem: string | null = null;
	if (isInside(stateDir, install.homeDir)) {
		consentProblem = `The Wheelhouse state directory ${stateDir} is inside the Firstmate home, so consent cannot be recorded.`;
	} else {
		consent = await ConsentStore.open(consentFileFor(stateDir, install.homeDir), install.homeDir);
		reached = await ReachedStore.open(reachedFileFor(stateDir, install.homeDir), install.homeDir);
	}
	return new PassageService({
		homeDir: install.homeDir,
		firstmateDir: install.firstmateDir,
		configDir,
		configProblem,
		consent,
		consentProblem,
		reached,
		deps: defaultDeps(env),
		useGh: env.WHEELHOUSE_NO_GH !== '1',
		ignore: [UNASSIGNED]
	});
}

/**
 * The message store lives in Wheelhouse's own state directory. Wheelhouse never
 * writes into the Firstmate home except through `fm-inbox.sh note`, so a state
 * directory inside the home is refused.
 */
async function createMessenger(
	install: FirstmateInstall,
	compatibility: Compatibility,
	adapter: FirstmateAdapter,
	env: NodeJS.ProcessEnv,
	route: (taskId: string) => string | null
): Promise<{ messenger: Messenger | null; reason: string | null }> {
	const stateDir = defaultStateDir(env);
	if (isInside(stateDir, install.homeDir)) {
		return {
			messenger: null,
			reason: `The Wheelhouse state directory ${stateDir} is inside the Firstmate home; choose one outside it with --state-dir.`
		};
	}
	let store: MessageStore;
	try {
		store = await MessageStore.open(storeFileFor(stateDir, install.homeDir), install.homeDir);
	} catch (e) {
		return {
			messenger: null,
			reason: `Wheelhouse could not read its message store in ${stateDir}: ${(e as Error).message}`
		};
	}
	const inbox = compatibility.scripts.find((s) => s.purpose === MESSAGING_PURPOSE);
	const unavailable = inbox?.ok
		? null
		: `This Firstmate’s inbox does not support Wheelhouse messages: ${
				inbox?.problem ?? 'fm-inbox.sh was not checked'
			}`;
	return { messenger: new Messenger({ adapter, store, unavailable, route }), reason: null };
}

export function getRuntime(env: NodeJS.ProcessEnv = process.env): Promise<Runtime> {
	let holder = g[KEY];
	if (!holder) {
		holder = {
			runtime: null,
			shutdown: shutdownRuntime,
			busy: busyRuntime,
			upgrade: upgradeRuntime
		};
		g[KEY] = holder;
	}
	holder.upgrade = upgradeRuntime;
	holder.busy = busyRuntime;
	holder.runtime ??= create(env);
	return holder.runtime;
}

/**
 * Take a WebSocket upgrade if it is for the terminal drawer; returns false for
 * any other URL, leaving the socket to its server.
 */
export function upgradeRuntime(req: IncomingMessage, socket: Duplex, head: Buffer): boolean {
	if (!isTerminalUrl(req.url)) return false;
	const runtime = g[KEY]?.runtime;
	if (!runtime) {
		refuseUpgrade(socket, 503, 'Wheelhouse is still starting.');
		return true;
	}
	void runtime.then((r) => {
		if (r.configured) r.terminals.handleUpgrade(req, socket, head);
		else refuseUpgrade(socket, 503, r.error);
	});
	return true;
}

/** What shutting down would stop: PR review runs and plugin services still starting. */
export async function busyRuntime(): Promise<string[]> {
	const r = await g[KEY]?.runtime;
	if (!r?.configured) return [];
	return [
		...r.review.runningTasks().map((t) => `a PR review agent on ${t}`),
		...(r.services?.starting() ?? []).map((k) => `the ${k} service, still starting`)
	];
}

/**
 * Stop polling, detach every browser terminal and kill our own in-flight
 * script runs. Firstmate is untouched: its session keeps running in tmux.
 */
export function shutdownRuntime(): void {
	const holder = g[KEY];
	void holder?.runtime?.then((r) => {
		if (r.configured) {
			if (sessionWatch) clearInterval(sessionWatch);
			sessionWatch = null;
			if (issueWatch) clearInterval(issueWatch);
			issueWatch = null;
			r.collector.stop();
			r.terminals.close();
			r.chat.stop();
			r.review.stopAll();
			r.sandbox.close();
		}
	});
	killAllRunning();
}

export function unconfiguredHealth(error: string): Health {
	return {
		schema: 'wheelhouse-health.v1',
		version,
		configured: false,
		firstmate: {
			dir: null,
			home: null,
			version: null,
			compatible: false,
			problems: [error],
			scripts: []
		},
		supervisor: {
			available: false,
			onWatch: null,
			reason: 'Wheelhouse is not connected to a Firstmate home.',
			observedAt: null,
			posture: null
		},
		collector: {
			intervalMs: 0,
			snapshotIntervalMs: 0,
			lastAttemptAt: null,
			lastSuccessAt: null,
			consecutiveFailures: 0,
			lastError: null
		},
		ledger: { available: false, reason: null },
		messaging: { available: false, reason: error, store: null },
		passages: { configDir: null, problem: error, checksRunning: 0 }
	};
}

export function unavailableMessages(reason: string): MessagesView {
	return {
		schema: 'wheelhouse-messages.v1',
		available: false,
		reason,
		messages: [],
		receiptsAt: null,
		receiptsError: null,
		storeError: null
	};
}

export async function currentMessages(): Promise<MessagesView> {
	const r = await getRuntime();
	if (!r.configured) return unavailableMessages(r.error);
	return r.messenger
		? r.messenger.view()
		: unavailableMessages(r.collector.health().messaging.reason ?? 'Messaging is not set up.');
}

export function unconfiguredFleet(error: string): FleetView {
	return {
		schema: 'wheelhouse-fleet.v1',
		generatedAt: null,
		collectedAt: null,
		stale: true,
		staleReason: error,
		projects: [],
		tasks: []
	};
}

export async function currentFleet(): Promise<FleetView> {
	const r = await getRuntime();
	return r.configured ? r.collector.getFleet() : unconfiguredFleet(r.error);
}

export async function currentHealth(): Promise<Health> {
	const r = await getRuntime();
	return r.configured ? r.collector.health() : unconfiguredHealth(r.error);
}

const NO_SLOTS: SlotView = { schema: 'wheelhouse-slots.v1', entries: [] };

/** Plugin entries for the slots about the fleet, one project or one task. */
export async function currentSlots(q: SlotQuery): Promise<SlotView> {
	const r = await getRuntime();
	return r.configured ? r.plugins.slots(q) : NO_SLOTS;
}

export async function currentPlugins(): Promise<PluginsView> {
	const r = await getRuntime();
	if (r.configured) return r.plugins.view();
	return {
		schema: 'wheelhouse-plugins.v1',
		supported: [],
		config: { file: null, error: null },
		installed: { dir: null, error: null },
		plugins: [],
		enabled: {},
		suggested: []
	};
}

/**
 * A file of a loaded installed plugin's UI bundle: under the directory its
 * manifest's `ui` entry sits in, symlinks resolved; null when there is no such
 * plugin or file, or the path leaves that directory.
 */
export async function pluginUiFile(pluginId: string, rel: string): Promise<string | null> {
	const r = await getRuntime();
	const dir = r.configured ? r.plugins.uiDir(pluginId) : null;
	return dir ? uiFile(dir, rel) : null;
}

/**
 * A plugin's companion service for the fleet or one project: whether it is up,
 * and whether a Launch can start it. With `launch`, starts it (only when the
 * captain asked: the route that passes it is a session-token POST) and waits
 * until it answers. Null when the plugin declares no such service there.
 */
export async function pluginService(
	q: { plugin: string; service: string; project: string | null },
	launch = false
): Promise<ServiceView | null> {
	const r = await getRuntime();
	if (!r.configured) return null;
	return serviceView(r.plugins, r.services, q, launch);
}

async function serviceView(
	plugins: PluginRegistry,
	services: ServiceManager | null,
	q: { plugin: string; service: string; project: string | null },
	launch = false
): Promise<ServiceView | null> {
	const found = await plugins.service(q.plugin, q.service, q.project);
	if (!found) return null;
	const base = { schema: 'wheelhouse-service.v1' as const, ...q, title: found.title };
	const res = found.resolution;
	const hint = res.hint ?? null;
	if (!res.available) {
		return {
			...base,
			state: 'unavailable',
			url: null,
			reason: res.reason,
			launchable: false,
			hint
		};
	}
	if (!services) {
		return {
			...base,
			state: 'unavailable',
			url: res.spec.url,
			reason:
				'Wheelhouse’s state directory is inside the Firstmate home, so it starts no services.',
			launchable: false,
			hint
		};
	}
	const key = `${q.plugin}-${q.service}${q.project ? `-${q.project}` : ''}`;
	const status = launch
		? await services.launch(key, res.spec)
		: await services.status(key, res.spec);
	const reason = res.spec.binds !== 'loopback' && res.note ? res.note : status.reason;
	return { ...base, ...status, reason, launchable: launchable(res.spec, status), hint };
}

/** Plugin entries for several pages' worth of slots at once, keyed as the page asked. */
export async function loadSlots(keys: SlotKey[]): Promise<Record<SlotKey, SlotView>> {
	const views = await Promise.all(keys.map((k) => currentSlots(parseSlotKey(k))));
	return Object.fromEntries(keys.map((k, i) => [k, views[i]]));
}

/** Firstmate's session lock, from its own readiness script. */
async function lockState(adapter: FirstmateAdapter): Promise<LockState> {
	const r = await adapter.ready();
	if (!r.ok) return 'unknown';
	const { state, liveHarness } = r.value.lock;
	if (state === 'held') return liveHarness === false ? 'free' : 'held';
	return state === 'free' || state === 'stale' ? 'free' : 'unknown';
}

/** Start the Firstmate session at launch and say what happened in Wheelhouse's own output. */
async function startFirstmate(session: FirstmateSession): Promise<void> {
	try {
		const v = await session.ensure();
		if (v.state === 'ours') {
			console.log(
				`Firstmate:  running in tmux (${v.attach}); talk to it on the home page.${
					v.skipPermissions ? '' : ' Started without --dangerously-skip-permissions.'
				}`
			);
		} else {
			console.log(`Firstmate:  ${v.reason ?? v.state}`);
		}
	} catch (e) {
		console.warn(`Firstmate:  could not start the session: ${(e as Error).message}`);
	}
}

export function unavailableFirstmate(reason: string): FirstmateSessionView {
	return {
		schema: 'wheelhouse-firstmate-session.v1',
		state: 'unavailable',
		reason,
		canSend: false,
		attach: null,
		skipPermissions: true,
		picker: null,
		menu: null,
		busy: false
	};
}

/**
 * The folders the captain may read Markdown from (see server/files/docfile.ts):
 * the Firstmate home, Firstmate's code, and each live task's project and worktree.
 */
export async function currentFileRoots(): Promise<FileRoots | null> {
	const r = await getRuntime();
	if (!r.configured) return null;
	const { homeDir, firstmateDir } = r.install;
	return {
		home: homeDir,
		roots: usableRoots([homeDir, firstmateDir, ...r.collector.knownDirs()])
	};
}

export async function currentDecisions(): Promise<DecisionsView> {
	const r = await getRuntime();
	if (!r.configured)
		return { schema: 'wheelhouse-decisions.v1', available: false, reason: r.error, decisions: [] };
	return r.insights.decisionsView();
}

export async function currentTime(): Promise<TimeView> {
	const r = await getRuntime();
	if (!r.configured)
		return {
			schema: 'wheelhouse-time.v1',
			available: false,
			reason: r.error,
			tasks: [],
			notes: []
		};
	return r.insights.time();
}

export async function currentHeadroom(): Promise<HeadroomView> {
	const r = await getRuntime();
	if (!r.configured) {
		return {
			schema: 'wheelhouse-headroom.v1',
			allowance: { state: 'unavailable', reason: r.error },
			usage: { available: false, reason: r.error },
			atRisk: null
		};
	}
	return r.insights.headroom();
}

const RAIL_DECISIONS = 30;

/** The rail's slice of the insights: recent decisions, today's time, and the allowance. */
export async function currentRailInsights(): Promise<RailInsights> {
	const [decisions, time, headroom] = await Promise.all([
		currentDecisions(),
		currentTime(),
		currentHeadroom()
	]);
	const midnight = new Date(new Date().toDateString()).getTime();
	return {
		schema: 'wheelhouse-rail-insights.v1',
		decisions: decisions.decisions.slice(0, RAIL_DECISIONS).map((d) => ({
			id: d.id,
			taskId: d.taskId,
			projectId: d.projectId,
			taskTitle: d.taskTitle,
			verdict: d.verdict,
			question: d.calls[0]?.question ?? '',
			decidedAt: d.decidedAt
		})),
		today: time.tasks
			.filter((t) => Date.parse(t.startedAt) >= midnight)
			.map((t) => ({ taskId: t.taskId, projectId: t.projectId, seconds: t.seconds })),
		allowance: headroom.allowance,
		atRisk: headroom.atRisk
	};
}

export function unavailableInbox(reason: string): InboxView {
	return { schema: 'wheelhouse-inbox.v1', available: false, reason, canAnswer: false, cards: [] };
}

/** Every open question in one stack (see server/inbox). */
export async function currentInbox(): Promise<InboxView> {
	const r = await getRuntime();
	return r.configured ? r.inbox.view() : unavailableInbox(r.error);
}
