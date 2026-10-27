import { existsSync } from 'node:fs';
import { realpath, open, readdir } from 'node:fs/promises';
import path from 'node:path';
import { normalizeBlocks, normalizeCards } from '../../plugins/blocks';
import {
	SLOT_SCOPE,
	SLOTS,
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
import type { ServicePorts } from './ports';
import {
	SUPPORTED_API_VERSIONS,
	type Contribution,
	type ExecRequest,
	type ExecResult,
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
	env?: NodeJS.ProcessEnv;
	now?: () => number;
}

export type { SlotQuery };

/** Bundled and installed plugins the loader read, and the ones that are off or could not be loaded. */
export interface InstalledPlugins {
	/** Where installed plugins live. */
	dir?: string | null;
	plugins?: InstalledPlugin[];
	problems?: PluginStatus[];
	/** Why the installed-plugins record could not be read, if it could not. */
	error?: string | null;
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
		if (c.slot === 'header.indicator' && 'blocks' in c.render) {
			return `contribution "${c.id}": header indicators render through a panel or an element only.`;
		}
		if ('element' in c.render && !elementTag(p.id, c.render.element)) {
			return `contribution "${c.id}": its element "${c.render.element}" must be a custom element tag starting "${p.id}-".`;
		}
	}
	const services = new Set<string>();
	for (const sv of p.services ?? []) {
		if (!ID.test(sv.id))
			return `service id "${sv.id}" is not lower-case letters, digits and dashes.`;
		if (services.has(sv.id)) return `it declares service "${sv.id}" twice.`;
		if (sv.scope !== 'fleet' && sv.scope !== 'project') {
			return `service "${sv.id}" has an unknown scope "${sv.scope}".`;
		}
		services.add(sv.id);
	}
	return null;
}

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
				enabledByDefault: p.enabledByDefault ?? false,
				enabledWhenFile: p.enabledWhenFile ?? null,
				enabledWhenHomeFile: p.enabledWhenHomeFile ?? null
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
			enabled
		};
	}

	/** Every enabled contribution for the slots about this fleet, project or task, filled. */
	async slots(q: SlotQuery): Promise<SlotView> {
		const { config } = await this.config();
		const fleet = this.host.fleet();
		let project: Project | null = null;
		let task: TaskSummary | null = null;
		if (q.scope === 'task') {
			task = fleet.tasks.find((t) => t.id === q.taskId) ?? null;
			if (!task) return { schema: 'wheelhouse-slots.v1', entries: [] };
			project = fleet.projects.find((p) => p.id === task!.projectId) ?? null;
		} else if (q.scope === 'project') {
			project = fleet.projects.find((p) => p.id === q.projectId) ?? null;
			if (!project) return { schema: 'wheelhouse-slots.v1', entries: [] };
		}

		const jobs: Promise<SlotEntry | null>[] = [];
		for (const plugin of this.loaded) {
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
			if (!on) continue;
			const settings = config.plugins[plugin.id]?.settings ?? {};
			const wholeFleet = homeOn !== null;
			for (const c of plugin.contributions) {
				if (SLOT_SCOPE[c.slot] !== q.scope) continue;
				const provider = plugin.providers.find((p) => p.id === c.provider)!;
				jobs.push(
					this.fill(plugin, c, provider, { project, task, projects, fleet, settings, wholeFleet })
				);
			}
		}
		const entries = (await Promise.all(jobs)).filter((e): e is SlotEntry => e !== null);
		entries.sort((a, b) => a.order - b.order || a.key.localeCompare(b.key));
		return { schema: 'wheelhouse-slots.v1', entries };
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
	private enabled(config: PluginConfig, plugin: WheelhousePlugin, project: Project): boolean {
		let defaultOn = plugin.enabledByDefault ?? false;
		const homeOn = this.homeDefault(plugin);
		if (homeOn !== null) {
			defaultOn = homeOn;
		} else if (plugin.enabledWhenFile !== undefined) {
			defaultOn =
				!!project.path &&
				path.isAbsolute(project.path) &&
				existsSync(path.join(project.path, plugin.enabledWhenFile));
		}
		return isEnabled(config, plugin, project.id, defaultOn);
	}

	/** For a plugin that names a home file, whether the Firstmate home has it; else null. */
	private homeDefault(plugin: WheelhousePlugin): boolean | null {
		if (plugin.enabledWhenHomeFile === undefined) return null;
		const home = this.host.home?.() ?? null;
		return (
			!!home && path.isAbsolute(home) && existsSync(path.join(home, plugin.enabledWhenHomeFile))
		);
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
			changedFiles: (id) => this.changedFiles(id, scope)
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
