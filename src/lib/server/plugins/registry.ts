import { existsSync } from 'node:fs';
import { realpath, open, readdir } from 'node:fs/promises';
import path from 'node:path';
import { matchHost, validHostTemplate } from '../../plugins/addresses';
import { normalizeBlocks, normalizeCards } from '../../plugins/blocks';
import {
	SLOT_SCOPE,
	SLOTS,
	type PluginPageView,
	type PluginStatus,
	type PluginsView,
	type Scope,
	type SlotEntry,
	type SlotView
} from '../../plugins/types';
import type { SlotQuery } from '../../plugins/keys';
import type { Available, Project, TaskSummary } from '../../types';
import { runBounded } from '../firstmate/exec';
import { EMPTY_CONFIG, isEnabled, type PluginConfig } from './config';
import type { InstalledPlugin } from './loader';
import type { SettingSpec } from './manifest';
import { settingViews } from './settings';
import type { ServicePorts } from './ports';
import { suggestedPlugins } from './suggested';
import {
	SUPPORTED_API_VERSIONS,
	type Contribution,
	type ExecRequest,
	type ExecResult,
	type HostRoute,
	type PluginMcpServer,
	type PluginService,
	type Provider,
	type ProviderContext,
	type ServiceContext,
	type Root,
	type ServiceResolution,
	type WheelhousePlugin
} from './types';

/**
 * The in-process plugin registry. It checks each plugin's manifest (compiled
 * in, or bundled or installed and imported by the loader) once at startup, refusing a plugin written for a contract version this
 * Wheelhouse does not support, then fills slots on request: it runs each
 * provider with a timeout, caches the result for the provider's ttl (then
 * serves the last good one while it refreshes), and turns
 * any failure into an "unavailable" entry, so one failing plugin never breaks
 * a page or another plugin.
 */

export { SUPPORTED_API_VERSIONS };
export const DEFAULT_TIMEOUT_MS = 3_000;
export const MAX_TIMEOUT_MS = 10_000;
/** A failure is retried after at most this long, whatever the provider's ttl. */
const MAX_FAILURE_TTL_MS = 15_000;
/** How long past its ttl a provider's last good answer may still be served while it refreshes. */
const MAX_STALE_MS = 10 * 60_000;
const MAX_EXEC_BYTES = 8 * 1024 * 1024;
const MAX_READ_BYTES = 64 * 1024;
const MAX_VALUE_BYTES = 256 * 1024;
const MAX_DIR_ENTRIES = 1000;
const ID = /^[a-z][a-z0-9-]{0,39}$/;
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const RANK: Record<Scope, number> = { fleet: 0, project: 1, task: 2 };

export interface RegistryHost {
	/** The current fleet, as the collector last read it. */
	fleet(): { projects: Project[]; tasks: TaskSummary[] };
	/** The worktree Firstmate recorded for a task, if any. */
	worktree(taskId: string): string | null;
	/** The Firstmate home directory, if Wheelhouse knows it. */
	home?(): string | null;
	/** Files a task changed against its base branch, or null when that cannot be read. */
	changedFiles?(taskId: string): Promise<string[] | null>;
	/** The plugins file, as last read. */
	config(): Promise<{ config: PluginConfig; error: string | null }>;
	configFile?: string | null;
	/** Where companion services keep their ports; without it a service gets the port it prefers. */
	servicePorts?: ServicePorts | null;
	/** The addresses on this computer Wheelhouse has shown (ProviderContext.loopbackAddresses). */
	loopbackAddresses?(): Promise<string[]>;
	/** Wheelhouse's own ports (ProviderContext.reservedPorts). */
	reservedPorts?(): number[];
	env?: NodeJS.ProcessEnv;
	now?: () => number;
}

export type { SlotQuery };

/** What decides where a plugin is on by default. */
type EnableRule = Pick<
	WheelhousePlugin,
	'id' | 'enabledByDefault' | 'enabledWhenFile' | 'enabledWhenHomeFile'
>;

/** Bundled and installed plugins the loader read, and the ones that are off or could not be loaded. */
export interface InstalledPlugins {
	/** Where installed plugins live. */
	dir?: string | null;
	plugins?: InstalledPlugin[];
	problems?: PluginStatus[];
	/** Why the installed-plugins record could not be read, if it could not. */
	error?: string | null;
}

type AppRender = Extract<Contribution['render'], { app: unknown }>;

/** An app contribution where it shows: the MCP server and tool it draws, and the tool's arguments. */
export interface AppTarget {
	plugin: { id: string; name: string };
	/** The contribution's title. */
	title: string;
	server: PluginMcpServer;
	tool: string;
	/** The project the server's service runs for (a per-project service), else null. */
	serviceProject: string | null;
	/** The provider's value: the tool's arguments, or why there are none. */
	args: Available<Record<string, unknown>>;
}

/** A custom element tag: the plugin's id, a dash, then lower-case letters, digits and dashes. */
const elementTag = (pluginId: string, tag: unknown) =>
	typeof tag === 'string' &&
	tag.length <= 80 &&
	tag.startsWith(`${pluginId}-`) &&
	/^[a-z][a-z0-9-]*-[a-z0-9-]+$/.test(tag);

/** Why a manifest cannot be loaded, or null when it can. */
export function checkManifest(p: WheelhousePlugin, taken: ReadonlySet<string>): string | null {
	if (!SUPPORTED_API_VERSIONS.includes(p.apiVersion)) {
		return `it was written for plugin contract ${p.apiVersion}; this Wheelhouse supports ${SUPPORTED_API_VERSIONS.join(' and ')}.`;
	}
	if (!ID.test(p.id)) return `its id "${p.id}" is not lower-case letters, digits and dashes.`;
	if (taken.has(p.id)) return `another plugin already uses the id "${p.id}".`;
	if (!SEMVER.test(p.version)) return `its version "${p.version}" is not a semantic version.`;
	if (p.enabledWhenFile !== undefined && !relativeFile(p.enabledWhenFile)) {
		return `enabledWhenFile "${p.enabledWhenFile}" is not a plain path inside a project clone.`;
	}
	if (p.enabledWhenHomeFile !== undefined && !relativeFile(p.enabledWhenHomeFile)) {
		return `enabledWhenHomeFile "${p.enabledWhenHomeFile}" is not a plain path inside the Firstmate home.`;
	}
	const providers = new Map<string, Provider>();
	for (const pr of p.providers) {
		if (!ID.test(pr.id))
			return `provider id "${pr.id}" is not lower-case letters, digits and dashes.`;
		if (providers.has(pr.id)) return `it declares provider "${pr.id}" twice.`;
		if (!(pr.scope in RANK)) return `provider "${pr.id}" has an unknown scope "${pr.scope}".`;
		providers.set(pr.id, pr);
	}
	const contributions = new Set<string>();
	for (const c of p.contributions) {
		if (!ID.test(c.id))
			return `contribution id "${c.id}" is not lower-case letters, digits and dashes.`;
		if (contributions.has(c.id)) return `it declares contribution "${c.id}" twice.`;
		contributions.add(c.id);
		if (!SLOTS.includes(c.slot)) return `contribution "${c.id}" names an unknown slot "${c.slot}".`;
		const pr = providers.get(c.provider);
		if (!pr) return `contribution "${c.id}" uses a provider it does not declare, "${c.provider}".`;
		if (RANK[pr.scope] > RANK[SLOT_SCOPE[c.slot]]) {
			return `contribution "${c.id}" puts a ${pr.scope} provider in ${c.slot}, which is about a ${SLOT_SCOPE[c.slot]}.`;
		}
		if (c.slot === 'step.evidence' && !c.placement?.step) {
			return `contribution "${c.id}" is step evidence but names no step.`;
		}
		if (c.slot === 'bridge.card' && !('blocks' in c.render)) {
			return `contribution "${c.id}": Bridge cards render through blocks only.`;
		}
		if (c.slot === 'header.indicator' && ('blocks' in c.render || 'app' in c.render)) {
			return `contribution "${c.id}": header indicators render through a panel or an element only.`;
		}
		if ('element' in c.render && !elementTag(p.id, c.render.element)) {
			return `contribution "${c.id}": its element "${c.render.element}" must be a custom element tag starting "${p.id}-".`;
		}
	}
	const services = new Map<string, PluginService>();
	for (const sv of p.services ?? []) {
		if (!ID.test(sv.id))
			return `service id "${sv.id}" is not lower-case letters, digits and dashes.`;
		if (services.has(sv.id)) return `it declares service "${sv.id}" twice.`;
		if (sv.scope !== 'fleet' && sv.scope !== 'project') {
			return `service "${sv.id}" has an unknown scope "${sv.scope}".`;
		}
		services.set(sv.id, sv);
	}
	const servers = new Map<string, PluginMcpServer>();
	for (const m of p.mcpServers ?? []) {
		if (!ID.test(m.id))
			return `MCP server id "${m.id}" is not lower-case letters, digits and dashes.`;
		if (servers.has(m.id)) return `it declares MCP server "${m.id}" twice.`;
		if (!services.has(m.service)) {
			return `MCP server "${m.id}" is served by a service it does not declare, "${m.service}".`;
		}
		if (!mcpPath(m.path)) {
			return `MCP server "${m.id}": its path "${m.path}" must be a path on the service's address, starting with one "/".`;
		}
		servers.set(m.id, m);
	}
	const routes = new Set<string>();
	for (const r of p.hostRoutes ?? []) {
		if (!ID.test(r.id))
			return `host route id "${r.id}" is not lower-case letters, digits and dashes.`;
		if (routes.has(r.id)) return `it declares host route "${r.id}" twice.`;
		routes.add(r.id);
		if (!validHostTemplate(r.host)) {
			return `host route "${r.id}" answers "${r.host}", which is not a host name ending in .localhost with {port} in its first label.`;
		}
		if (typeof r.request !== 'function') return `host route "${r.id}" has no request function.`;
		if (taken.has(`host:${r.host}`)) return `another plugin already answers ${r.host}.`;
	}
	const rewrites = new Set<string>();
	for (const r of p.addressRewrites ?? []) {
		if (!ID.test(r.id))
			return `address rewrite id "${r.id}" is not lower-case letters, digits and dashes.`;
		if (rewrites.has(r.id)) return `it declares address rewrite "${r.id}" twice.`;
		rewrites.add(r.id);
		if (!validHostTemplate(r.to)) {
			return `address rewrite "${r.id}" sends addresses to "${r.to}", which is not a host name ending in .localhost with {port} in its first label.`;
		}
	}
	for (const c of p.contributions) {
		if (!('app' in c.render)) continue;
		const app = c.render.app as { server?: unknown; tool?: unknown } | null;
		const server = typeof app?.server === 'string' ? servers.get(app.server) : undefined;
		if (!server) {
			return `contribution "${c.id}" draws an app from an MCP server it does not declare, "${String(app?.server)}".`;
		}
		if (typeof app?.tool !== 'string' || !app.tool || app.tool.length > 128) {
			return `contribution "${c.id}" names no tool for its app.`;
		}
		if (services.get(server.service)!.scope === 'project' && SLOT_SCOPE[c.slot] === 'fleet') {
			return `contribution "${c.id}" puts an app from a per-project MCP server in ${c.slot}, which is about the fleet.`;
		}
	}
	return null;
}

/** An absolute path on a service's own address (never `//host`, which would leave it). */
export const mcpPath = (v: unknown): v is string =>
	typeof v === 'string' && v.length <= 200 && /^\/(?![/\\])[\x21-\x7e]*$/.test(v);

/** A relative path that stays inside the directory it is relative to. */
function relativeFile(f: unknown): f is string {
	return (
		typeof f === 'string' &&
		f.length > 0 &&
		!path.isAbsolute(f) &&
		!f.split(/[\\/]/).some((part) => part === '..' || part === '')
	);
}

/** What one provider call is about. */
interface Scope_ {
	project: Project | null;
	task: TaskSummary | null;
	projects: Project[];
	tasks: TaskSummary[];
	settings: Record<string, unknown>;
}

interface CacheEntry {
	at: number;
	ttl: number;
	value: Available<unknown> | null;
	pending: Promise<Available<unknown>> | null;
}

const failed = (reason: string): Available<never> => ({ available: false, reason });

function message(e: unknown): string {
	return e instanceof Error ? e.message : String(e);
}

/** The provider's result, if it has the Available shape and can be sent to a page. */
function checkResult(r: unknown, name: string): Available<unknown> {
	if (
		typeof r !== 'object' ||
		r === null ||
		typeof (r as { available?: unknown }).available !== 'boolean'
	) {
		return failed(`The ${name} plugin returned something Wheelhouse does not understand.`);
	}
	const a = r as Record<string, unknown>;
	if (a.available === false) {
		return failed(
			typeof a.reason === 'string' ? a.reason : `The ${name} plugin has nothing to show.`
		);
	}
	let json: string | undefined;
	try {
		json = JSON.stringify(a.value);
	} catch {
		json = undefined;
	}
	if (json === undefined || json.length > MAX_VALUE_BYTES) {
		return failed(`The ${name} plugin returned data Wheelhouse cannot show.`);
	}
	return {
		available: true,
		value: JSON.parse(json),
		source: typeof a.source === 'string' ? a.source : `the ${name} plugin`,
		observedAt: typeof a.observedAt === 'string' ? a.observedAt : null
	};
}

export class PluginRegistry {
	private readonly loaded: WheelhousePlugin[] = [];
	private readonly statuses: PluginStatus[] = [];
	private readonly cache = new Map<string, CacheEntry>();
	private readonly now: () => number;
	/** Loaded bundled and installed plugins' UI bundles, by plugin id. */
	private readonly uis = new Map<string, { dir: string; url: string }>();

	/** `plugins` are the compiled-in ones; the loader's (bundled, then installed) load after them. */
	constructor(
		plugins: WheelhousePlugin[],
		private readonly host: RegistryHost,
		private readonly installed: InstalledPlugins = {}
	) {
		this.now = host.now ?? Date.now;
		const taken = new Set<string>();
		const all = [
			...plugins.map((plugin) => ({ plugin, from: null })),
			...(installed.plugins ?? []).map((i) => ({ plugin: i.plugin, from: i }))
		];
		for (const { plugin: p, from } of all) {
			let reason: string | null;
			let slots: PluginStatus['slots'] = [];
			try {
				reason = checkManifest(p, taken);
				slots = [...new Set(p.contributions.map((c) => c.slot))];
			} catch (e) {
				reason = `its manifest could not be checked: ${message(e)}`;
			}
			if (!reason) {
				taken.add(p.id);
				for (const r of p.hostRoutes ?? []) taken.add(`host:${r.host}`);
				this.loaded.push(p);
				if (from?.ui) {
					const v = encodeURIComponent(
						from.commit ? `${p.version}-${from.commit.slice(0, 12)}` : p.version
					);
					this.uis.set(p.id, {
						dir: from.ui.dir,
						url: `/api/plugins/${p.id}/ui/${encodeURIComponent(from.ui.entry)}?v=${v}`
					});
				}
			}
			this.statuses.push({
				id: p.id,
				name: p.name,
				version: p.version,
				apiVersion: p.apiVersion,
				state: reason ? 'refused' : 'loaded',
				reason: reason ? `Wheelhouse did not load ${p.name}: ${reason}` : null,
				source: from?.source ?? 'builtin',
				repository: from?.repository ?? null,
				commit: from?.commit ?? null,
				slots,
				hostRoutes: reason ? [] : (p.hostRoutes ?? []).map((r) => r.host),
				addressRewrites: reason ? [] : (p.addressRewrites ?? []).map((r) => r.to),
				enabledByDefault: p.enabledByDefault ?? false,
				enabledWhenFile: p.enabledWhenFile ?? null,
				enabledWhenHomeFile: p.enabledWhenHomeFile ?? null,
				description: from?.description ?? null,
				settings: from?.settings ?? []
			});
		}
		this.statuses.push(...(installed.problems ?? []));
	}

	status(): PluginStatus[] {
		return this.statuses;
	}

	/** The directory a loaded bundled or installed plugin's UI bundle is served from, or null. */
	uiDir(pluginId: string): string | null {
		return this.uis.get(pluginId)?.dir ?? null;
	}

	async view(): Promise<PluginsView> {
		const { config, error } = await this.config();
		const enabled: Record<string, string[]> = {};
		for (const p of this.host.fleet().projects) {
			enabled[p.id] = this.loaded.filter((pl) => this.enabled(config, pl, p)).map((pl) => pl.id);
		}
		return {
			schema: 'wheelhouse-plugins.v1',
			supported: SUPPORTED_API_VERSIONS,
			config: { file: this.host.configFile ?? null, error },
			installed: { dir: this.installed.dir ?? null, error: this.installed.error ?? null },
			plugins: this.statuses,
			enabled,
			suggested: suggestedPlugins(this.statuses, (rel) => this.homeHas(rel))
		};
	}

	/** Every enabled contribution for the slots about this fleet, project or task, filled. */
	async slots(q: SlotQuery): Promise<SlotView> {
		const where = await this.where(q);
		if (!where) return { schema: 'wheelhouse-slots.v1', entries: [] };
		const jobs: Promise<SlotEntry | null>[] = [];
		for (const plugin of this.loaded) {
			const scope = this.pluginScope(plugin, q, where);
			if (!scope) continue;
			for (const c of plugin.contributions) {
				if (SLOT_SCOPE[c.slot] !== q.scope) continue;
				const provider = plugin.providers.find((p) => p.id === c.provider)!;
				jobs.push(this.fill(plugin, c, provider, scope));
			}
		}
		const entries = (await Promise.all(jobs)).filter((e): e is SlotEntry => e !== null);
		entries.sort((a, b) => a.order - b.order || a.key.localeCompare(b.key));
		return { schema: 'wheelhouse-slots.v1', entries };
	}

	/**
	 * One `app` contribution, filled where it shows (the fleet, a project or a
	 * task), with the MCP server it draws from: the tool's arguments (its
	 * provider's value), or why there are none. Null when the plugin has no
	 * such app contribution there.
	 */
	async app(ref: {
		plugin: string;
		contribution: string;
		project: string | null;
		task: string | null;
	}): Promise<AppTarget | null> {
		const plugin = this.loaded.find((p) => p.id === ref.plugin);
		const c = plugin?.contributions.find((x) => x.id === ref.contribution);
		if (!plugin || !c || !('app' in c.render)) return null;
		const slotScope = SLOT_SCOPE[c.slot];
		const q: SlotQuery | null =
			slotScope === 'fleet'
				? { scope: 'fleet' }
				: slotScope === 'project'
					? ref.project
						? { scope: 'project', projectId: ref.project }
						: null
					: ref.task
						? { scope: 'task', taskId: ref.task }
						: null;
		if (!q) return null;
		const where = await this.where(q);
		if (!where) return null;
		const server = plugin.mcpServers!.find((m) => m.id === (c.render as AppRender).app.server)!;
		const service = plugin.services!.find((s) => s.id === server.service)!;
		const base = {
			plugin: { id: plugin.id, name: plugin.name },
			title: c.title,
			server,
			tool: (c.render as AppRender).app.tool,
			serviceProject: service.scope === 'project' ? (where.project?.id ?? null) : null
		};
		const scope = this.pluginScope(plugin, q, where);
		if (!scope) return { ...base, args: failed(`${plugin.name} is off here.`) };
		const provider = plugin.providers.find((p) => p.id === c.provider)!;
		const entry = await this.fill(plugin, { ...c, when: 'always' }, provider, scope);
		return { ...base, args: entry!.content as Available<Record<string, unknown>> };
	}

	/**
	 * The plugin MCP server a tool call in Firstmate's chat went to, by the
	 * name Claude Code gives the tool: `mcp__<server>__<tool>`, where
	 * `<server>` is the server's id or, for a server a Claude Code plugin
	 * brings, `plugin_<plugin>_<server>`. Only a name exactly one loaded
	 * plugin's server answers to counts, and only while that plugin is on;
	 * anything else is null and stays text.
	 * A server on a per-project service is the one for the project the call's
	 * `project` argument names. The call's arguments are the target's.
	 */
	async chatApp(name: string, input: Record<string, unknown>): Promise<AppTarget | null> {
		const m = /^mcp__(.+?)__(.+)$/.exec(name);
		if (!m) return null;
		const [, serverName, tool] = m;
		const found = this.loaded.flatMap((plugin) =>
			(plugin.mcpServers ?? [])
				.filter((s) => serverName === s.id || serverName === `plugin_${plugin.id}_${s.id}`)
				.map((server) => ({ plugin, server }))
		);
		if (found.length !== 1) return null;
		const { plugin, server } = found[0];
		const service = plugin.services!.find((s) => s.id === server.service)!;
		let q: SlotQuery = { scope: 'fleet' };
		if (service.scope === 'project') {
			if (typeof input.project !== 'string' || !input.project) return null;
			q = { scope: 'project', projectId: input.project };
		}
		const where = await this.where(q);
		if (!where || !this.pluginScope(plugin, q, where)) return null;
		return {
			plugin: { id: plugin.id, name: plugin.name },
			title: tool,
			server,
			tool,
			serviceProject: where.project?.id ?? null,
			args: { available: true, value: input, source: 'Firstmate’s tool call', observedAt: null }
		};
	}

	/** The project and task a slot query is about, or null when there is no such one. */
	private async where(q: SlotQuery) {
		const { config } = await this.config();
		const fleet = this.host.fleet();
		let project: Project | null = null;
		let task: TaskSummary | null = null;
		if (q.scope === 'task') {
			task = fleet.tasks.find((t) => t.id === q.taskId) ?? null;
			if (!task) return null;
			project = fleet.projects.find((p) => p.id === task!.projectId) ?? null;
		} else if (q.scope === 'project') {
			project = fleet.projects.find((p) => p.id === q.projectId) ?? null;
			if (!project) return null;
		}
		return { config, fleet, project, task };
	}

	/** What one plugin's providers see for a slot query, or null when the plugin is off there. */
	private pluginScope(
		plugin: WheelhousePlugin,
		q: SlotQuery,
		w: NonNullable<Awaited<ReturnType<PluginRegistry['where']>>>
	) {
		const { config, fleet, project, task } = w;
		const projects = fleet.projects.filter((p) => this.enabled(config, plugin, p));
		// A plugin about the Firstmate home is on for the fleet by its own setting, not its projects'.
		const homeOn = this.homeDefault(plugin);
		const on =
			q.scope === 'fleet'
				? homeOn === null
					? projects.length > 0
					: isEnabled(config, plugin, '', homeOn)
				: project
					? this.enabled(config, plugin, project)
					: isEnabled(config, plugin, task!.projectId, homeOn ?? undefined);
		if (!on) return null;
		const settings = config.plugins[plugin.id]?.settings ?? {};
		return { project, task, projects, fleet, settings, wholeFleet: homeOn !== null };
	}

	/**
	 * Drop every answer cached for a plugin's providers, so the next read asks
	 * again: for Wheelhouse's own code that has just changed what a built-in
	 * plugin reads (the vault, after a change made on its page).
	 */
	forget(pluginId: string): void {
		for (const k of [...this.cache.keys()]) if (k.startsWith(`${pluginId}/`)) this.cache.delete(k);
	}

	/**
	 * A built-in (compiled-in or bundled) plugin's fleet provider, read for
	 * Wheelhouse's own code as a fleet slot reads it: the same projects, cache,
	 * timeout and checks. Null when there is no such loaded built-in plugin or
	 * fleet provider, or the plugin is on for no project. An installed plugin is
	 * never read this way, so nothing Wheelhouse does on its own rests on one.
	 */
	async builtinFleetValue(
		pluginId: string,
		providerId: string
	): Promise<Available<unknown> | null> {
		const plugin = this.loaded.find((p) => p.id === pluginId);
		const provider = plugin?.providers.find((p) => p.id === providerId && p.scope === 'fleet');
		const status = this.statuses.find((s) => s.id === pluginId && s.state === 'loaded');
		if (!plugin || !provider || status?.source !== 'builtin') return null;
		const { config } = await this.config();
		const fleet = this.host.fleet();
		const projects = fleet.projects.filter((p) => this.enabled(config, plugin, p));
		const homeOn = this.homeDefault(plugin);
		const on = homeOn === null ? projects.length > 0 : isEnabled(config, plugin, '', homeOn);
		if (!on) return null;
		const visible = new Set(projects.map((p) => p.id));
		return this.run(plugin, provider, {
			project: null,
			task: null,
			projects,
			tasks: fleet.tasks.filter((t) => homeOn !== null || visible.has(t.projectId)),
			settings: config.plugins[plugin.id]?.settings ?? {}
		});
	}

	/**
	 * The host templates (see lib/plugins/addresses.ts) addresses on this
	 * computer are shown at: every loaded plugin's address rewrites, while it
	 * is on, in load order. Pages use the first.
	 */
	async addressRewrites(): Promise<string[]> {
		const { config } = await this.config();
		return this.loaded
			.filter((p) => p.addressRewrites?.length && this.onAnywhere(config, p))
			.flatMap((p) => p.addressRewrites!.map((r) => r.to));
	}

	/**
	 * The host route that answers `hostname` (a `*.localhost` name without its
	 * port), with the port it carries and its plugin's settings, while that
	 * plugin is on; null when none does.
	 */
	async hostRoute(hostname: string): Promise<{
		plugin: string;
		route: HostRoute;
		port: number;
		settings: Record<string, unknown>;
	} | null> {
		for (const plugin of this.loaded) {
			for (const route of plugin.hostRoutes ?? []) {
				const port = matchHost(route.host, hostname);
				if (port === null) continue;
				const { config } = await this.config();
				if (!this.onAnywhere(config, plugin)) return null;
				return {
					plugin: plugin.id,
					route,
					port,
					settings: structuredClone(config.plugins[plugin.id]?.settings ?? {})
				};
			}
		}
		return null;
	}

	/**
	 * Whether a plugin is on anywhere: by its own switch (or its home file), or
	 * for any project. For what a plugin does for the whole computer, such as
	 * its host routes and address rewrites.
	 */
	private onAnywhere(config: PluginConfig, plugin: WheelhousePlugin): boolean {
		const homeOn = this.homeDefault(plugin);
		return (
			isEnabled(config, plugin, '', homeOn ?? plugin.enabledByDefault ?? false) ||
			this.host.fleet().projects.some((p) => this.enabled(config, plugin, p))
		);
	}

	/**
	 * A plugin's companion service, resolved for the fleet or one project, with
	 * its title; null when there is no such service for that scope. A plugin that
	 * is off there resolves to "unavailable" with the reason.
	 */
	async service(
		pluginId: string,
		serviceId: string,
		projectId: string | null
	): Promise<{ title: string; resolution: ServiceResolution } | null> {
		const plugin = this.loaded.find((p) => p.id === pluginId);
		const decl = plugin?.services?.find((sv) => sv.id === serviceId);
		if (!plugin || !decl || (decl.scope === 'project') !== (projectId !== null)) return null;
		const { config } = await this.config();
		const fleet = this.host.fleet();
		const projects = fleet.projects.filter((p) => this.enabled(config, plugin, p));
		const off = (where: string) => ({
			title: decl.title,
			resolution: { available: false as const, reason: `${plugin.name} is off ${where}.` }
		});
		let project: Project | null = null;
		if (projectId !== null) {
			project = fleet.projects.find((p) => p.id === projectId) ?? null;
			if (!project) return null;
			if (!this.enabled(config, plugin, project)) return off(`for ${project.name}`);
		} else {
			const homeOn = this.homeDefault(plugin);
			const on = homeOn === null ? projects.length > 0 : isEnabled(config, plugin, '', homeOn);
			if (!on) return off('here');
		}
		const scope: Scope_ = {
			project,
			task: null,
			projects,
			tasks: project ? fleet.tasks.filter((t) => t.projectId === project!.id) : fleet.tasks,
			settings: config.plugins[plugin.id]?.settings ?? {}
		};
		const controller = new AbortController();
		const key = `${plugin.id}/${decl.id}${project ? `/${project.id}` : ''}`;
		const ctx: ServiceContext = {
			...this.context(scope, DEFAULT_TIMEOUT_MS * 2, this.now(), controller),
			servicePort: async (preferred, avoid = []) =>
				(await this.host.servicePorts?.port(
					key,
					project?.id ?? null,
					preferred,
					avoid,
					fleet.projects.map((p) => p.id)
				)) ?? preferred
		};
		let timer: ReturnType<typeof setTimeout> | undefined;
		try {
			const resolution = await Promise.race([
				Promise.resolve().then(() => decl.resolve(ctx)),
				new Promise<ServiceResolution>((resolve) => {
					timer = setTimeout(() => {
						controller.abort();
						resolve({
							available: false,
							reason: `${plugin.name} did not say how to start it in time.`
						});
					}, DEFAULT_TIMEOUT_MS * 2);
				})
			]);
			return { title: decl.title, resolution };
		} catch (e) {
			return {
				title: decl.title,
				resolution: { available: false, reason: `${plugin.name} failed: ${message(e)}` }
			};
		} finally {
			clearTimeout(timer);
		}
	}

	/** Whether a plugin is on for a project: the captain's file, else the plugin's default there. */
	private enabled(config: PluginConfig, plugin: EnableRule, project: Project): boolean {
		return isEnabled(config, plugin, project.id, this.defaultOn(plugin, project));
	}

	/** Whether a plugin is on for a project by its own rule, with nothing in the captain's file. */
	private defaultOn(plugin: EnableRule, project: Project): boolean {
		const homeOn = this.homeDefault(plugin);
		if (homeOn !== null) return homeOn;
		if (plugin.enabledWhenFile !== undefined) {
			return (
				!!project.path &&
				path.isAbsolute(project.path) &&
				existsSync(path.join(project.path, plugin.enabledWhenFile))
			);
		}
		return plugin.enabledByDefault ?? false;
	}

	/** For a plugin that names a home file, whether the Firstmate home has it; else null. */
	private homeDefault(plugin: EnableRule): boolean | null {
		if (plugin.enabledWhenHomeFile === undefined) return null;
		return this.homeHas(plugin.enabledWhenHomeFile);
	}

	/**
	 * One plugin's page: where it is on, for every project and each one, and
	 * its declared settings with what the plugins file holds; null when
	 * Wheelhouse knows no plugin with this id.
	 */
	async page(id: string): Promise<PluginPageView | null> {
		const status =
			this.statuses.find((s) => s.id === id && s.state === 'loaded') ??
			this.statuses.find((s) => s.id === id);
		if (!status) return null;
		const { config, error } = await this.config();
		const rule: EnableRule = {
			id,
			enabledByDefault: status.enabledByDefault,
			enabledWhenFile: status.enabledWhenFile ?? undefined,
			enabledWhenHomeFile: status.enabledWhenHomeFile ?? undefined
		};
		const own = config.plugins[id];
		const homeOn = this.homeDefault(rule);
		return {
			schema: 'wheelhouse-plugin.v1',
			plugin: status,
			enabled: own?.enabled ?? null,
			on: own?.enabled ?? homeOn ?? rule.enabledByDefault ?? false,
			projects: this.host.fleet().projects.map((p) => ({
				id: p.id,
				name: p.name,
				enabled: own?.projects?.[p.id] ?? null,
				defaultOn: this.defaultOn(rule, p),
				on: this.enabled(config, rule, p)
			})),
			settings: settingViews(status.settings as SettingSpec[], own?.settings ?? {}),
			configError: error
				? 'Wheelhouse’s plugins file is not valid, so every plugin keeps its default and nothing can be changed here until it is fixed.'
				: null
		};
	}

	private homeHas(rel: string): boolean {
		const home = this.host.home?.() ?? null;
		return !!home && path.isAbsolute(home) && existsSync(path.join(home, rel));
	}

	private async config(): Promise<{ config: PluginConfig; error: string | null }> {
		try {
			return await this.host.config();
		} catch (e) {
			return { config: EMPTY_CONFIG, error: message(e) };
		}
	}

	private async fill(
		plugin: WheelhousePlugin,
		c: Contribution,
		provider: Provider,
		scope: {
			project: Project | null;
			task: TaskSummary | null;
			projects: Project[];
			fleet: { projects: Project[]; tasks: TaskSummary[] };
			settings: Record<string, unknown>;
			/** A plugin about the Firstmate home sees every task, including unassigned ones. */
			wholeFleet: boolean;
		}
	): Promise<SlotEntry | null> {
		// A provider sees only as much as its own scope: a fleet provider in a task slot sees no task.
		const project = provider.scope === 'fleet' ? null : scope.project;
		const task = provider.scope === 'task' ? scope.task : null;
		const visible = new Set(scope.projects.map((p) => p.id));
		const tasks = project
			? scope.fleet.tasks.filter((t) => t.projectId === project.id)
			: scope.fleet.tasks.filter((t) => scope.wholeFleet || visible.has(t.projectId));
		const raw = await this.run(plugin, provider, {
			project,
			task,
			projects: scope.projects,
			tasks,
			settings: scope.settings
		});

		let content: Available<unknown> = raw;
		if (raw.available && 'blocks' in c.render) {
			const n = c.slot === 'bridge.card' ? normalizeCards(raw.value) : normalizeBlocks(raw.value);
			content = n.ok
				? { ...raw, value: 'cards' in n ? n.cards : n.blocks }
				: failed(
						`The ${plugin.name} plugin returned something Wheelhouse cannot show: ${n.reason}.`
					);
		} else if (
			raw.available &&
			'app' in c.render &&
			(typeof raw.value !== 'object' || raw.value === null || Array.isArray(raw.value))
		) {
			content = failed(`The ${plugin.name} plugin gave its app arguments that are not an object.`);
		}
		if (!content.available && c.when === 'provider-available') return null;
		let badge: number | null = null;
		if (content.available && c.badge) {
			try {
				const n = c.badge(structuredClone(content.value));
				badge = typeof n === 'number' && Number.isInteger(n) && n > 0 ? n : null;
			} catch {
				badge = null;
			}
		}

		const perProject = SLOT_SCOPE[c.slot] === 'project' && scope.project;
		return {
			key: `${plugin.id}/${c.id}${perProject ? `@${scope.project!.id}` : ''}`,
			slot: c.slot,
			pluginId: plugin.id,
			contributionId: c.id,
			title: c.title,
			order: c.placement?.order ?? 500,
			step: c.placement?.step ?? null,
			projectId: scope.project?.id ?? null,
			...(SLOT_SCOPE[c.slot] === 'task' ? { taskId: scope.task?.id ?? null } : {}),
			render: c.render,
			...('element' in c.render ? { ui: this.uis.get(plugin.id)?.url ?? null } : {}),
			badge,
			content
		};
	}

	/** One provider call, shared by every contribution that uses it and reused for its ttl. */
	private run(
		plugin: WheelhousePlugin,
		provider: Provider,
		scope: Scope_
	): Promise<Available<unknown>> {
		const key = `${plugin.id}/${provider.id}/${scope.task?.id ?? scope.project?.id ?? ''}`;
		const now = this.now();
		const hit = this.cache.get(key);
		if (hit?.value && !hit.pending && now - hit.at < hit.ttl) return Promise.resolve(hit.value);
		// After its ttl, the last answer that worked is served while one refresh runs.
		const stale = hit?.value?.available && now - hit.at < hit.ttl + MAX_STALE_MS ? hit.value : null;
		if (hit?.pending) return stale ? Promise.resolve(stale) : hit.pending;

		const pending = this.call(plugin, provider, scope).then((value) => {
			const ttl = value.available ? provider.ttlMs : Math.min(provider.ttlMs, MAX_FAILURE_TTL_MS);
			const at = this.now();
			for (const [k, e] of this.cache) {
				if (!e.pending && at - e.at >= e.ttl + MAX_STALE_MS) this.cache.delete(k);
			}
			this.cache.set(key, { at, ttl, value, pending: null });
			return value;
		});
		this.cache.set(key, {
			at: hit?.at ?? now,
			ttl: hit?.ttl ?? 0,
			value: hit?.value ?? null,
			pending
		});
		return stale ? Promise.resolve(stale) : pending;
	}

	private async call(
		plugin: WheelhousePlugin,
		provider: Provider,
		scope: Scope_
	): Promise<Available<unknown>> {
		const timeoutMs = Math.min(
			Math.max(provider.timeoutMs ?? DEFAULT_TIMEOUT_MS, 1),
			MAX_TIMEOUT_MS
		);
		const started = this.now();
		const controller = new AbortController();
		const ctx = this.context(scope, timeoutMs, started, controller);

		let timer: ReturnType<typeof setTimeout> | undefined;
		const timeout = new Promise<Available<unknown>>((resolve) => {
			timer = setTimeout(() => {
				controller.abort();
				resolve(failed(`The ${plugin.name} plugin did not answer within ${timeoutMs} ms.`));
			}, timeoutMs);
		});
		const work = Promise.resolve()
			.then(() => provider.fetch(ctx))
			.then(
				(r) => checkResult(r, plugin.name),
				(e) => failed(`The ${plugin.name} plugin failed: ${message(e)}`)
			);
		try {
			return await Promise.race([work, timeout]);
		} finally {
			clearTimeout(timer);
		}
	}

	/** What a provider (or a service's resolver) reads through, for one scope and time budget. */
	private context(
		scope: Scope_,
		timeoutMs: number,
		started: number,
		controller: AbortController
	): ProviderContext {
		const ctx: ProviderContext = {
			project: scope.project,
			task: scope.task,
			projects: structuredClone(scope.projects),
			tasks: structuredClone(scope.tasks),
			settings: structuredClone(scope.settings),
			signal: controller.signal,
			exec: (r) =>
				this.exec(r, scope, Math.max(1, timeoutMs - (Date.now() - started)), controller.signal),
			readFile: (rel, o) => this.readFile(rel, o, scope),
			listDir: (rel, o) => this.listDir(rel, o, scope),
			changedFiles: (id) => this.changedFiles(id, scope),
			loopbackAddresses: async () => (await this.host.loopbackAddresses?.()) ?? [],
			reservedPorts: () => this.host.reservedPorts?.() ?? []
		};
		if (ctx.project) ctx.project = structuredClone(ctx.project);
		if (ctx.task) ctx.task = structuredClone(ctx.task);
		return ctx;
	}

	private root(which: Root, projectId: string | undefined, scope: Scope_) {
		const project =
			projectId === undefined ? scope.project : scope.projects.find((p) => p.id === projectId);
		const dir =
			which === 'home'
				? (this.host.home?.() ?? null)
				: which === 'project'
					? project?.path
					: scope.task
						? this.host.worktree(scope.task.id)
						: null;
		return dir && path.isAbsolute(dir) ? dir : null;
	}

	/** An existing path under one of the roots, symlinks resolved, or null when it leaves the root. */
	private async inside(
		rel: string,
		o: { root: Root; project?: string },
		scope: Scope_
	): Promise<string | null> {
		const root = this.root(o.root, o.project, scope);
		if (!root || typeof rel !== 'string' || path.isAbsolute(rel)) return null;
		try {
			const base = await realpath(root);
			const file = await realpath(path.resolve(base, rel));
			return file === base || file.startsWith(base + path.sep) ? file : null;
		} catch {
			return null;
		}
	}

	private async exec(
		r: ExecRequest,
		scope: Scope_,
		left: number,
		signal: AbortSignal
	): Promise<ExecResult> {
		const refuse = (reason: string): ExecResult => ({ ok: false, reason, stdout: '', stderr: '' });
		if (signal.aborted) return refuse('the plugin call timed out');
		const cwd = this.root(r.cwd, r.project, scope);
		if (!cwd) return refuse(`there is no ${r.cwd} directory to run in`);
		if (!Array.isArray(r.argv) || !r.argv.length || r.argv.some((a) => typeof a !== 'string')) {
			return refuse('argv must be a non-empty list of strings');
		}
		const env = this.host.env ?? process.env;
		const res = await runBounded(r.argv[0], r.argv.slice(1), {
			cwd,
			env: {
				PATH: env.PATH ?? '/usr/bin:/bin',
				HOME: env.HOME ?? '',
				LANG: env.LANG ?? 'C.UTF-8',
				GIT_TERMINAL_PROMPT: '0',
				GIT_OPTIONAL_LOCKS: '0',
				GH_PROMPT_DISABLED: '1'
			},
			timeoutMs: Math.max(1, Math.min(r.timeoutMs, left)),
			maxOutputBytes: Math.max(1, Math.min(r.maxBytes, MAX_EXEC_BYTES)),
			maxErrorBytes: 4 * 1024
		});
		return res.ok
			? { ok: true, stdout: res.stdout }
			: { ok: false, reason: res.message, stdout: res.stdout, stderr: res.stderr };
	}

	private async changedFiles(taskId: string, scope: Scope_): Promise<string[] | null> {
		if (!this.host.changedFiles || !scope.tasks.some((t) => t.id === taskId)) return null;
		try {
			const files = await this.host.changedFiles(taskId);
			return files ? [...files] : null;
		} catch {
			return null;
		}
	}

	private async listDir(
		rel: string,
		o: { root: Root; project?: string },
		scope: Scope_
	): Promise<string[] | null> {
		const dir = await this.inside(rel, o, scope);
		if (!dir) return null;
		try {
			return (await readdir(dir)).sort().slice(0, MAX_DIR_ENTRIES);
		} catch {
			return null;
		}
	}

	private async readFile(
		rel: string,
		o: { root: Root; maxBytes: number; project?: string },
		scope: Scope_
	): Promise<string | null> {
		const file = await this.inside(rel, o, scope);
		if (!file) return null;
		try {
			const max = Math.max(0, Math.min(o.maxBytes, MAX_READ_BYTES));
			const fh = await open(file, 'r');
			try {
				const buf = Buffer.alloc(max);
				const { bytesRead } = await fh.read(buf, 0, max, 0);
				return buf.subarray(0, bytesRead).toString('utf8');
			} finally {
				await fh.close();
			}
		} catch {
			return null;
		}
	}
}
