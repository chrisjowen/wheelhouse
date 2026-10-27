/**
 * The Wheelhouse plugin contract, version 1, as a plugin sees it. Wheelhouse's
 * own definitions are in src/lib/server/plugins/types.ts and
 * src/lib/plugins/types.ts; a test there checks these stay compatible.
 */

export declare const PLUGIN_API_VERSION: 1;
export declare const SLOTS: readonly Slot[];

export type Slot =
	| 'project.tab'
	| 'harbour.card'
	| 'task.section'
	| 'step.evidence'
	| 'bridge.card'
	| 'home.card'
	| 'header.indicator'
	| 'nav.page';

/** What a provider's call is about: the whole fleet, one project, or one task. */
export type Scope = 'fleet' | 'project' | 'task';

export type Tone = 'ok' | 'warn' | 'fail' | 'pending' | 'unknown';

export type Block =
	| { block: 'text.v1'; text: string; muted?: boolean }
	| { block: 'kv.v1'; items: { key: string; value: string; href?: string }[] }
	| { block: 'table.v1'; columns: string[]; rows: (string | { text: string; href: string })[][] }
	| { block: 'links.v1'; links: { label: string; href: string; note?: string }[] }
	| { block: 'image.v1'; src: string; alt: string; href?: string }
	| { block: 'status.v1'; tone: Tone; label: string; detail?: string }
	| {
			block: 'graph.v1';
			nodes: { id: string; label: string; kind?: string }[];
			edges: { from: string; to: string; label?: string }[];
	  };

/** A Bridge card: shown under a Firstmate reply that contains one of its URLs exactly. */
export interface BridgeCard {
	key: string;
	title: string;
	mentions: string[];
	blocks: Block[];
}

export type Available<T> =
	| { available: true; value: T; source: string; observedAt: string | null }
	| { available: false; reason: string };

/** A project in Firstmate's fleet. */
export interface Project {
	id: string;
	name: string;
	description: string | null;
	/** The project's clone, when Firstmate recorded one. */
	path: string | null;
}

/** A task in the fleet: the fields plugins can rely on (Wheelhouse passes more). */
export interface Task {
	id: string;
	title: string;
	shortTitle: string;
	projectId: string;
	kind: string | null;
	status: string;
	statusLabel: string;
	branch: string | null;
	pr: { url: string; number: number | null } | null;
	preview: { url: string; reportedAt: string } | null;
	since: string | null;
	completedOn: string | null;
	mergedAt: string | null;
}

/** Where a provider reads and runs: the project clone, the task worktree, or the Firstmate home. */
export type Root = 'project' | 'task' | 'home';

export interface ExecRequest {
	argv: string[];
	cwd: Root;
	/** For `cwd: 'project'` outside a project scope: which of `ctx.projects` to run in. */
	project?: string;
	timeoutMs: number;
	/** Output beyond this fails the call. Capped at 8 MiB. */
	maxBytes: number;
}

export type ExecResult =
	{ ok: true; stdout: string } | { ok: false; reason: string; stdout: string; stderr: string };

/** What a provider reads through. There is no way to write, message Firstmate or control workers. */
export interface ProviderContext {
	project: Project | null;
	task: Task | null;
	projects: Project[];
	tasks: Task[];
	exec(c: ExecRequest): Promise<ExecResult>;
	readFile(
		rel: string,
		o: { root: Root; maxBytes: number; project?: string }
	): Promise<string | null>;
	listDir(rel: string, o: { root: Root; project?: string }): Promise<string[] | null>;
	changedFiles(taskId: string): Promise<string[] | null>;
	/** The plugin's `settings` from the captain's plugins file. */
	settings: Record<string, unknown>;
	signal: AbortSignal;
}

export interface Provider {
	id: string;
	scope: Scope;
	ttlMs: number;
	/** Per call; defaults to 3 s and is capped at 10 s. */
	timeoutMs?: number;
	fetch(ctx: ProviderContext): Promise<Available<unknown>>;
}

/**
 * How an installed plugin's contribution is drawn: Wheelhouse's blocks, or the
 * custom element of this tag (`<plugin id>-<name>`) its UI bundle defines.
 */
export type Render = { blocks: true } | { element: string };

export interface Contribution {
	slot: Slot;
	id: string;
	title: string;
	provider: string;
	when?: 'always' | 'provider-available';
	placement?: { order?: number; step?: string };
	render: Render;
	badge?(value: unknown): number | null;
}

export interface ServiceSpec {
	url: string;
	health: string;
	identity?: { url: string; path: string[]; value?: string };
	argv: string[];
	cwd: string;
	env?: Record<string, string>;
	binds: 'loopback' | 'all';
	setup?: { label: string; argv: string[]; cwd?: string; timeoutMs: number }[];
	readyTimeoutMs?: number;
}

export interface ServiceContext extends ProviderContext {
	servicePort(preferred: number, avoid?: number[]): Promise<number>;
}

export type ServiceResolution =
	| { available: true; spec: ServiceSpec; hint?: string | null; note?: string | null }
	| { available: false; reason: string; hint?: string | null };

export interface PluginService {
	id: string;
	title: string;
	scope: 'fleet' | 'project';
	resolve(ctx: ServiceContext): Promise<ServiceResolution>;
}

/**
 * What a plugin's server entry default-exports. Its id, version, contract and
 * enablement come from the manifest; if it repeats them they must agree.
 */
export interface WheelhousePlugin {
	id?: string;
	version?: string;
	apiVersion?: number;
	providers: Provider[];
	contributions: Contribution[];
	services?: PluginService[];
}

/** The slot entry an element receives as its `entry` property. */
export interface SlotEntry {
	key: string;
	slot: Slot;
	pluginId: string;
	contributionId: string;
	title: string;
	projectId: string | null;
}

/** A companion service as the page sees it (`GET /api/services`). */
export interface ServiceView {
	schema: 'wheelhouse-service.v1';
	plugin: string;
	service: string;
	project: string | null;
	title: string;
	/** `occupied`: something else answers at its address, so Wheelhouse does not start it there. */
	state: 'running' | 'stopped' | 'starting' | 'failed' | 'occupied' | 'unavailable';
	url: string | null;
	/** Why it is unavailable, failed or cannot be started, in plain words. */
	reason: string | null;
	/** The end of the launch log, after a failed start. */
	log?: string;
	/** Whether Wheelhouse can start it (show a Launch button). */
	launchable: boolean;
	/** A command to start it by hand, when the plugin knows one. */
	hint: string | null;
}

/**
 * What Wheelhouse lets a plugin's element do: read and start the plugin's own
 * companion services, for the entry's project unless `project` names another.
 * The page supplies the session token, so the element need not handle it; this
 * does not hide the token, since the element runs with the page's permissions.
 */
export interface PluginHost {
	readonly pluginId: string;
	/** Whether the service is up; null when the plugin declares no such service there. */
	service(service: string, o?: { project?: string | null }): Promise<ServiceView | null>;
	/**
	 * Start the service and, once it answers, open `open` (or its own address)
	 * in a new tab. Call it from a click handler only.
	 */
	launch(
		service: string,
		o?: { project?: string | null; open?: string | null }
	): Promise<ServiceView | null>;
}

/**
 * A plugin's custom element: Wheelhouse sets `host` (before the others),
 * `entry` and `data` (the provider's value).
 */
export interface PluginElement<T = unknown> extends HTMLElement {
	data: T;
	entry: SlotEntry;
	host: PluginHost;
}

export declare function definePlugin<P extends WheelhousePlugin>(plugin: P): P;
export declare function available<T>(
	value: T,
	source: string,
	observedAt?: string | null
): { available: true; value: T; source: string; observedAt: string | null };
export declare function unavailable(reason: string): { available: false; reason: string };
export declare function text(text: string, o?: { muted?: boolean }): Block;
export declare function kv(items: { key: string; value: string; href?: string }[]): Block;
export declare function table(
	columns: string[],
	rows: (string | { text: string; href: string })[][]
): Block;
export declare function links(links: { label: string; href: string; note?: string }[]): Block;
export declare function image(src: string, alt: string, href?: string): Block;
export declare function status(tone: Tone, label: string, detail?: string): Block;
export declare function graph(
	nodes: { id: string; label: string; kind?: string }[],
	edges: { from: string; to: string; label?: string }[]
): Block;
