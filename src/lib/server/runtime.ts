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
import { InsightsService } from './insights/service';
import { BuildReader } from './buildlog/reader';
import { BUILTIN_PLUGINS } from './plugins/builtin';
import { defaultConfigDir, PLUGINS_FILE, PluginConfigFile } from './plugins/config';
import { PluginRegistry } from './plugins/registry';
import { parseSlotKey, type SlotKey, type SlotQuery } from '../plugins/keys';
import { defaultDeps } from './passages/checks';
import { ConsentStore, consentFileFor } from './passages/consent';
import { ReachedStore, reachedFileFor } from './passages/reached';
import { PassageService } from './passages/service';
import { Messenger } from './store/messenger';
import { FirstmateSession, type LockState } from './sessions/firstmate';
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
import type { PluginsView, SlotView } from '../plugins/types';

/**
 * Process-wide wiring: one adapter, one collector, one evidence reader, one
 * messenger, one plugin registry and one session manager. The CLI passes the
 * resolved Firstmate paths through WHEELHOUSE_FIRSTMATE_DIR and WHEELHOUSE_HOME,
 * and the message store's directory through WHEELHOUSE_STATE_DIR; the plugins
 * file is read from the config directory (see defaultConfigDir). In development
 * the same variables can be set by hand. WHEELHOUSE_TMUX_SOCKET (--tmux-socket)
 * names the tmux server the Firstmate session runs on, which the runtime starts
 * when none is running, and WHEELHOUSE_SKIP_PERMISSIONS=0 (--no-skip-permissions) starts it without
 * --dangerously-skip-permissions.
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
			evidence: EvidenceReader;
			messenger: Messenger | null;
			plugins: PluginRegistry;
			firstmate: FirstmateSession;
			chat: ChatFeed;
			terminals: TerminalServer;
			passages: PassageService;
			insights: InsightsService;
			build: BuildReader;
	  }
	| { configured: false; error: string };

interface RuntimeHolder {
	runtime: Promise<Runtime> | null;
	shutdown: () => void;
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
	const adapter = createScriptAdapter(install);
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
	const messaging = await createMessenger(install, compatibility, adapter, env);
	const passages = await createPassages(install, env);
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
		build
	});
	collector.start();
	const pluginsFile = new PluginConfigFile(path.join(defaultConfigDir(env), PLUGINS_FILE));
	const plugins = new PluginRegistry(BUILTIN_PLUGINS, {
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
		env
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
	void startFirstmate(firstmate);
	const terminals = new TerminalServer({ resolve: firstmate.terminal });
	return {
		configured: true,
		install,
		adapter,
		collector,
		evidence,
		messenger: messaging.messenger,
		plugins,
		firstmate,
		chat,
		terminals,
		passages,
		insights,
		build
	};
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
	env: NodeJS.ProcessEnv
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
	return { messenger: new Messenger({ adapter, store, unavailable }), reason: null };
}

export function getRuntime(env: NodeJS.ProcessEnv = process.env): Promise<Runtime> {
	let holder = g[KEY];
	if (!holder) {
		holder = { runtime: null, shutdown: shutdownRuntime, upgrade: upgradeRuntime };
		g[KEY] = holder;
	}
	holder.upgrade = upgradeRuntime;
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

/**
 * Stop polling, detach every browser terminal and kill our own in-flight
 * script runs. Firstmate is untouched: its session keeps running in tmux.
 */
export function shutdownRuntime(): void {
	const holder = g[KEY];
	void holder?.runtime?.then((r) => {
		if (r.configured) {
			r.collector.stop();
			r.terminals.close();
			r.chat.stop();
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
		plugins: [],
		enabled: {}
	};
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
		busy: false
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
