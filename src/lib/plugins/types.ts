import type { Available } from '../types';
import type { PluginSettingView } from '../updates';

/**
 * The plugin contract the UI sees: fixed slots, typed blocks, and the entries
 * the server fills them with. Shared by the server and the browser; the
 * server-side plugin interface lives in `$lib/server/plugins/types.ts`.
 */

/** Where a plugin can contribute. The set is fixed; plugins cannot add slots. */
export const SLOTS = [
	'project.tab',
	'harbour.card',
	'task.section',
	'step.evidence',
	'bridge.card',
	'home.card',
	'header.indicator',
	'nav.page',
	'preview.action'
] as const;

export type Slot = (typeof SLOTS)[number];

/**
 * What a plugin may do beyond reading, each declared in its manifest and so
 * shown to the captain before it is installed. `feedback`: send Firstmate a
 * feedback list about one task, in the preview feedback list's shape, on the
 * captain's click (see server/plugins/feedback.ts).
 */
export const CAPABILITIES = ['feedback'] as const;

export type Capability = (typeof CAPABILITIES)[number];

/**
 * Parts of Wheelhouse a plugin can take over, each declared in its manifest's
 * `provides` and so shown to the captain before it is installed. A role has
 * one provider at a time, which the captain chooses in Settings → Plugins
 * (the plugins file's `roles`); with none chosen, or the chosen one off or
 * gone, Wheelhouse's own built-in does the job. `review.surface`: where the
 * captain reviews what the crew shows them. Its built-in is Firstmate's
 * Lavish boards and Wheelhouse's preview helper; while a provider is on,
 * Wheelhouse hides its own preview helper and board links, makes the
 * provider's preview.action the primary button on every live preview, and
 * tells Firstmate (through the manage-wheelhouse skill) to use it instead of
 * Lavish.
 */
export const ROLES = ['review.surface'] as const;

export type Role = (typeof ROLES)[number];

/** A role as Wheelhouse has it now: who may provide it, who was chosen, and who does. */
export interface RoleView {
	role: Role;
	/** The plugin the plugins file chooses for it, or null for the built-in. */
	chosen: string | null;
	/** The plugin doing the job now: the chosen one while it is loaded and on; else null, the built-in. */
	active: RoleProvider | null;
	/** Every loaded plugin whose manifest says it provides the role, and whether it is on. */
	providers: (RoleProvider & { on: boolean })[];
}

/** A plugin that provides a role. */
export interface RoleProvider {
	id: string;
	name: string;
}

/** What a slot is about, and so which providers can fill it. */
export type Scope = 'fleet' | 'project' | 'task';

export const SLOT_SCOPE: Record<Slot, Scope> = {
	'project.tab': 'project',
	'harbour.card': 'project',
	'task.section': 'task',
	'step.evidence': 'task',
	'bridge.card': 'fleet',
	'home.card': 'fleet',
	'header.indicator': 'fleet',
	'nav.page': 'fleet',
	// One entry for every preview: what it acts on is handed to its element (PreviewContext).
	'preview.action': 'fleet'
};

/**
 * The preview a preview.action element acts on, set as its `preview` property
 * beside `data`: the address the captain sees (on this computer; for a remote
 * second mate's preview, the end of its forward here), the task that reported
 * it when one did, and whether it is a review board.
 */
export interface PreviewContext {
	url: string;
	taskId: string | null;
	title: string | null;
	projectId: string | null;
	board: boolean;
	/**
	 * Whether this element is the primary button on the preview: its plugin is
	 * the active review surface (see ROLES), so it stands in for Wheelhouse's
	 * own preview helper and should look like the main thing to do.
	 */
	primary?: boolean;
}

export type Tone = 'ok' | 'warn' | 'fail' | 'pending' | 'unknown';

/**
 * Built-in typed blocks, each a versioned schema. Wheelhouse renders them with
 * its own components; a block it does not know renders as a plain fallback.
 * Links and images accept only http(s) URLs or same-origin paths.
 */
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
	  }
	| { block: 'unknown'; type: string; preview: string };

export type BlockType = Exclude<Block['block'], 'unknown'>;

/**
 * How an entry is drawn: built-in blocks, a compiled-in plugin's own Svelte
 * panel, a custom element an installed plugin's UI bundle defines, or an MCP
 * app: the UI of `tool` on one of the plugin's own MCP servers, which
 * Wheelhouse calls with the provider's value as its arguments and draws in a
 * sandboxed frame.
 */
export type Render =
	| { blocks: true }
	| { component: string }
	| { element: string }
	| { app: { server: string; tool: string } };

/** One plugin contribution, filled for one project or task, ready to render. */
export interface SlotEntry {
	/** Unique per page: `<plugin>/<contribution>`, plus `@<project>` for per-project entries. */
	key: string;
	slot: Slot;
	pluginId: string;
	contributionId: string;
	title: string;
	/** Sort order within the slot (lower first). */
	order: number;
	/** step.evidence: the passage step it sits under; task.section: the step it follows, if any. */
	step: string | null;
	/** The project an entry belongs to (project-scoped slots). */
	projectId: string | null;
	/** The task a task slot's entry is about. */
	taskId?: string | null;
	render: Render;
	/** For an `element` entry, where its plugin's UI bundle is served (a same-origin path). */
	ui?: string | null;
	/** For a nav.page entry whose manifest names a menu icon, where it is served (a same-origin path). */
	icon?: string;
	/** A count to show beside the entry (its contribution's badge), or null. */
	badge: number | null;
	/**
	 * For `blocks`, the value is `Block[]`; for a component or an element,
	 * whatever its provider returned. bridge.card values are `BridgeCard[]`.
	 */
	content: Available<unknown>;
}

/** A Bridge card: shown under a Firstmate reply that contains one of its URLs exactly. */
export interface BridgeCard {
	key: string;
	title: string;
	mentions: string[];
	blocks: Block[];
}

export interface SlotView {
	schema: 'wheelhouse-slots.v1';
	entries: SlotEntry[];
}

export interface PluginStatus {
	id: string;
	name: string;
	version: string;
	apiVersion: number;
	/**
	 * `refused`: its manifest breaks the contract; `failed`: a bundled or installed
	 * plugin that could not be read or imported; `disabled`: installed but turned off
	 * with `wheelhouse plugin disable`.
	 */
	state: 'loaded' | 'refused' | 'failed' | 'disabled';
	/** Why the plugin was refused or failed, in plain words. */
	reason: string | null;
	/** Built in (compiled into or bundled with Wheelhouse), or installed with `wheelhouse plugin install`. */
	source: 'builtin' | 'installed';
	/** An installed plugin's repository (`org/repo`) and the exact commit installed. */
	repository: string | null;
	commit: string | null;
	slots: Slot[];
	/** Host templates (`{port}.localhost`) whose requests go to it while it is on. */
	hostRoutes: string[];
	/** Host templates it shows addresses on this computer at while it is on. */
	addressRewrites: string[];
	/** What it may do beyond reading (see CAPABILITIES). */
	capabilities: Capability[];
	/** The parts of Wheelhouse it can take over (see ROLES). */
	provides: Role[];
	enabledByDefault: boolean;
	/** On by default only for projects whose clone has this file. */
	enabledWhenFile: string | null;
	/** On by default, everywhere, only while the Firstmate home has this file. */
	enabledWhenHomeFile: string | null;
	/** What its manifest says it is for. */
	description: string | null;
	/** The settings its manifest declares, in its order. */
	settings: PluginSettingView[];
}

export interface PluginsView {
	schema: 'wheelhouse-plugins.v1';
	/** Plugin contract versions this Wheelhouse supports. */
	supported: number[];
	/** The captain-owned enablement file, and why it could not be used, if it could not. */
	config: { file: string | null; error: string | null };
	/** Where installed plugins live, and why their record could not be read, if it could not. */
	installed: { dir: string | null; error: string | null };
	plugins: PluginStatus[];
	/** Effective enablement per project id, for the projects Wheelhouse knows. */
	enabled: Record<string, string[]>;
	/** First-party plugins this Firstmate home uses that are not installed, and how to install them. */
	suggested: SuggestedPlugin[];
	/** Each role a plugin can take over, with who provides it now (see ROLES). */
	roles: RoleView[];
}

/** One plugin's own page: where it is on, and its settings, as the plugins file has them. */
export interface PluginPageView {
	schema: 'wheelhouse-plugin.v1';
	plugin: PluginStatus;
	/** The plugins file's own on or off for every project, or null when it keeps its default. */
	enabled: boolean | null;
	/** On for every project unless a project says otherwise: the file's choice, else the default. */
	on: boolean;
	projects: PluginProjectView[];
	/** Its declared settings, each with what the plugins file holds for it. */
	settings: PluginSettingView[];
	/** Why the plugins file cannot be changed here, in plain words, or null when it can. */
	configError: string | null;
}

export interface PluginProjectView {
	id: string;
	name: string;
	/** The plugins file's choice for this project, or null when it follows the plugin. */
	enabled: boolean | null;
	/** Whether it would be on here by its own rule, with nothing in the plugins file. */
	defaultOn: boolean;
	/** Whether it is on here now. */
	on: boolean;
}

export interface SuggestedPlugin {
	id: string;
	name: string;
	/** Its repository, `org/repo`. */
	repository: string;
	/** Why Wheelhouse suggests it, in plain words. */
	reason: string;
	/** The exact command that installs it. */
	command: string;
}

/**
 * A plugin's companion service as resolved for one scope: the command that
 * starts it, where it serves and how to tell it is up. Declared by a
 * first-party plugin's own code; Wheelhouse checks it and starts it only when
 * the captain asks.
 */
export interface ServiceSpec {
	/** Where to open it: an http(s) address on this computer. */
	url: string;
	/** Answers with a 2xx once the service is up. */
	health: string;
	/**
	 * Which one answers: a JSON answer at `url` with a field at `path`. With a
	 * `value`, the field must equal it, and the check is skipped when the answer
	 * does not carry the field; without one, the field must be there.
	 */
	identity?: { url: string; path: string[]; value?: string };
	/** The command, without a shell. */
	argv: string[];
	/** An absolute directory to run in. */
	cwd: string;
	env?: Record<string, string>;
	/** Wheelhouse starts only services that listen on loopback alone. */
	binds: 'loopback' | 'all';
	/** Steps run first, in order, each to completion (say, installing dependencies). */
	setup?: { label: string; argv: string[]; cwd?: string; timeoutMs: number }[];
	/** How long to wait for it to answer after starting (default 30 s, at most 2 min). */
	readyTimeoutMs?: number;
}

export interface ServiceStatus {
	/** `occupied`: something else answers at its address, so Wheelhouse does not start it there. */
	state: 'running' | 'stopped' | 'starting' | 'failed' | 'occupied' | 'unavailable';
	url: string | null;
	/** Why it is unavailable, failed or cannot be started, in plain words. */
	reason: string | null;
	/** The end of the launch log, after a failed start. */
	log?: string;
}

/** A service as the page sees it: its status, and how to start it by hand when Wheelhouse cannot. */
export interface ServiceView extends ServiceStatus {
	schema: 'wheelhouse-service.v1';
	plugin: string;
	service: string;
	project: string | null;
	title: string;
	/** Whether a Launch button can start it. */
	launchable: boolean;
	/** A command to start it by hand, when the plugin knows one. */
	hint: string | null;
}
