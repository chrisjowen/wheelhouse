import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
import type { Render, Scope, ServiceSpec, Slot } from '../../plugins/types';
import type { Available, Project, TaskSummary } from '../../types';

/**
 * The server-side plugin contract ("panels and providers"). A plugin is
 * compiled into Wheelhouse or installed (see `manifest.ts` and `loader.ts`): a manifest, providers that read data on the
 * server, and contributions that put a provider's output in a fixed UI slot.
 * Providers read only through ProviderContext; there is no way to write,
 * message Firstmate or control workers. The one exception is a host route,
 * which answers requests for a `*.localhost` name the plugin declares.
 */

/** The plugin contract version this file describes. */
export const PLUGIN_API_VERSION = 1;

/** Contract versions this host loads: the current one and, once there is one, the previous. */
export const SUPPORTED_API_VERSIONS = [PLUGIN_API_VERSION, PLUGIN_API_VERSION - 1].filter(
	(v) => v >= 1
);

export interface WheelhousePlugin {
	/** The plugin contract version the plugin was written against; checked before loading. */
	apiVersion: number;
	/** Lower-case letters, digits and dashes, e.g. `project-links`. */
	id: string;
	name: string;
	/** The plugin's own version (semver). */
	version: string;
	/** On for every project unless the captain's plugins file turns it off (default false). */
	enabledByDefault?: boolean;
	/**
	 * On by default only for projects whose clone has this file (a path relative
	 * to the clone, e.g. `.docket.yaml`); takes the place of enabledByDefault.
	 * The captain's plugins file still wins.
	 */
	enabledWhenFile?: string;
	/**
	 * On by default, for the fleet and every project, only while the Firstmate
	 * home has this file (a path relative to the home, e.g. `.harness/improve.json`);
	 * takes the place of enabledByDefault and enabledWhenFile. For a plugin about
	 * Firstmate itself rather than one project. The captain's plugins file still wins.
	 */
	enabledWhenHomeFile?: string;
	providers: Provider[];
	contributions: Contribution[];
	/** Local services the plugin's pages link to, which Wheelhouse can start on request. */
	services?: PluginService[];
	/**
	 * MCP servers whose apps the plugin's contributions draw (`render: { app }`),
	 * each served over HTTP by one of the plugin's own companion services.
	 */
	mcpServers?: PluginMcpServer[];
	/**
	 * While the plugin is on, Wheelhouse shows every http address on
	 * 127.0.0.1 or localhost under the first such rewrite's host template
	 * (see lib/plugins/addresses.ts), on the viewer's own Wheelhouse port.
	 */
	addressRewrites?: AddressRewrite[];
	/** `*.localhost` names whose requests, while the plugin is on, go to its own code. */
	hostRoutes?: HostRoute[];
}

/** Show addresses on Wheelhouse's computer at `to`, a host template such as `{port}.localhost`. */
export interface AddressRewrite {
	id: string;
	to: string;
}

/**
 * Requests for `host` (a host template, such as `{port}.localhost`) on
 * Wheelhouse's own port, handed to the plugin while it is on, before
 * Wheelhouse's own pages see them. Wheelhouse first refuses anything that
 * changes something (any method but GET, HEAD and OPTIONS) and every
 * WebSocket unless it comes from that host's own page (its Origin); with the
 * plugin off the host gets the 421 any foreign Host gets. The handler gets the
 * request and its response (or the upgrade's socket) as Node gives them, and
 * answers it in full: this is the one place a plugin serves anything.
 */
export interface HostRoute {
	id: string;
	host: string;
	request(req: IncomingMessage, res: ServerResponse, ctx: HostRouteContext): void | Promise<void>;
	/** WebSocket upgrades; without it they are refused. */
	upgrade?(
		req: IncomingMessage,
		socket: Duplex,
		head: Buffer,
		ctx: HostRouteContext
	): void | Promise<void>;
}

export interface HostRouteContext {
	/** The Host as the browser sent it, lower-case, with Wheelhouse's port. */
	host: string;
	/** The page's own origin there: `http://<host>`. */
	origin: string;
	/** The port the host name carries in place of `{port}`. */
	port: number;
	/** The plugin's `settings` from the captain's plugins file (empty when it has none). */
	settings: Record<string, unknown>;
	/** As a provider's: the addresses on this computer Wheelhouse has shown. */
	loopbackAddresses(): Promise<string[]>;
	/** Wheelhouse's own ports, the request's own included. */
	reservedPorts(): number[];
}

/**
 * An MCP server a plugin declares: Streamable HTTP at `path` on the address
 * of its companion `service`, so it runs where that service runs (for the
 * fleet or one project) and starts with the same Launch. Wheelhouse connects
 * to no other MCP server.
 */
export interface PluginMcpServer {
	id: string;
	title: string;
	/** One of the plugin's own service ids. */
	service: string;
	/** The MCP endpoint on the service's address, such as `/mcp`. */
	path: string;
}

/**
 * A companion service: a local web UI the plugin links to (improve's review
 * UI, docket's viewer). `resolve` works out, through the same context as a
 * provider, the exact command and address for the fleet or one project, or
 * why it cannot run; Wheelhouse starts it only on the captain's click.
 */
export interface PluginService {
	id: string;
	title: string;
	scope: 'fleet' | 'project';
	resolve(ctx: ServiceContext): Promise<ServiceResolution>;
}

/** What a service's resolver reads through: a provider's context, and the service's own port. */
export interface ServiceContext extends ProviderContext {
	/**
	 * The port Wheelhouse keeps for this service (and project): the first time,
	 * the first one from `preferred` up that no other service holds, `avoid`
	 * does not name and nothing listens on; the same one from then on, until the
	 * project leaves the fleet.
	 */
	servicePort(preferred: number, avoid?: number[]): Promise<number>;
}

export type ServiceResolution =
	| {
			available: true;
			spec: ServiceSpec;
			hint?: string | null;
			/** Why Wheelhouse will not start it, in the plugin's words, when it listens on every interface. */
			note?: string | null;
	  }
	| { available: false; reason: string; hint?: string | null };

export interface Provider {
	id: string;
	/** What one call is about: the whole fleet, one project, or one task. */
	scope: Scope;
	/** How long a result (or failure) is reused. Providers never run on the 5 s fleet poll. */
	ttlMs: number;
	/** Per call; defaults to 3 s and is capped at 10 s. */
	timeoutMs?: number;
	fetch(ctx: ProviderContext): Promise<Available<unknown>>;
}

export interface ProviderContext {
	/** The project in scope (project and task providers). */
	project: Project | null;
	/** The task in scope (task providers). */
	task: TaskSummary | null;
	/** Read-only copies: every project, and the tasks in scope (the project's, or all). */
	projects: Project[];
	tasks: TaskSummary[];
	/**
	 * Run a command without a shell, in the project clone, the task worktree or
	 * the Firstmate home, with a minimal environment and bounded time and output.
	 * Read-only by contract: Wheelhouse does not sandbox it.
	 */
	exec(c: ExecRequest): Promise<ExecResult>;
	/**
	 * Read a file under the project clone (`project` names one of `ctx.projects`
	 * outside a project scope), the task worktree or the Firstmate home; null if
	 * absent or outside it. Reads at most 64 KiB.
	 */
	readFile(
		rel: string,
		o: { root: Root; maxBytes: number; project?: string }
	): Promise<string | null>;
	/**
	 * The names in a directory under the same roots as readFile, sorted (at most
	 * 1000); null if it is absent or outside the root.
	 */
	listDir(rel: string, o: { root: Root; project?: string }): Promise<string[] | null>;
	/**
	 * Files one of `tasks` changed against its base branch, including uncommitted
	 * and untracked ones, as Wheelhouse's task evidence reads them; null when
	 * Wheelhouse cannot tell (no worktree, or not one of `tasks`).
	 */
	changedFiles(taskId: string): Promise<string[] | null>;
	/** The plugin's `settings` from the captain's plugins file (empty when it has none). */
	settings: Record<string, unknown>;
	/**
	 * The http(s) addresses on 127.0.0.1 or localhost Wheelhouse has shown
	 * since it started: in a task's preview or status, a decision card, or
	 * Firstmate's replies.
	 */
	loopbackAddresses(): Promise<string[]>;
	/** Ports on this computer that are Wheelhouse's own: its server and its MCP app sandboxes. */
	reservedPorts(): number[];
	/** Aborted when the call times out. */
	signal: AbortSignal;
}

/** Where a provider reads and runs: the project clone, the task worktree, or the Firstmate home. */
export type Root = 'project' | 'task' | 'home';

export interface ExecRequest {
	argv: string[];
	cwd: Root;
	/** For `cwd: 'project'` outside a project scope: which of `ctx.projects` to run in. */
	project?: string;
	/** Capped by what is left of the provider's own timeout. */
	timeoutMs: number;
	/** Output beyond this fails the call. Capped at 8 MiB. */
	maxBytes: number;
}

/** `stderr` is the start of the command's error output (at most 4 KiB). */
export type ExecResult =
	{ ok: true; stdout: string } | { ok: false; reason: string; stdout: string; stderr: string };

export interface Contribution {
	slot: Slot;
	id: string;
	title: string;
	/** A provider id from the same plugin, whose scope fits the slot. */
	provider: string;
	/** Hide the entry while its provider has nothing to show (default: show why). */
	when?: 'always' | 'provider-available';
	/**
	 * `order` sorts within the slot (lower first). `step` is required for step.evidence;
	 * on a task.section it pins the section right after that passage step, falling
	 * back to `order` when the task's passage has no such step.
	 */
	placement?: { order?: number; step?: string };
	/**
	 * `blocks`: the provider returns Block[] (BridgeCard[] for bridge.card).
	 * `component`: a key in the panel registry (`src/lib/plugins/panels.ts`),
	 * given the provider's value as `data`. bridge.card renders blocks only.
	 * `app`: the UI of `tool` on one of the plugin's `mcpServers`; the provider
	 * returns the tool's arguments (a JSON object).
	 */
	render: Render;
	/**
	 * A count the host shows beside the entry where it has room for one (the tab
	 * a home.card gets on the home page's rail), from the provider's value; null
	 * or 0 shows none. A badge that throws or is not a count is dropped.
	 */
	badge?(value: unknown): number | null;
}
