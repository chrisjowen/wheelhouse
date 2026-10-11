import { realpath, open } from 'node:fs/promises';
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
import {
	PLUGIN_API_VERSION,
	type Contribution,
	type ExecRequest,
	type ExecResult,
	type Provider,
	type ProviderContext,
	type WheelhousePlugin
} from './types';

/**
 * The in-process plugin registry. It checks each compiled-in plugin's manifest
 * once at startup, refusing a plugin written for a contract version this
 * Wheelhouse does not support, then fills slots on request: it runs each
 * provider with a timeout, caches the result for the provider's ttl, and turns
 * any failure into an "unavailable" entry, so one failing plugin never breaks
 * a page or another plugin.
 */

/** Contract versions this host loads: the current one and, once there is one, the previous. */
export const SUPPORTED_API_VERSIONS = [PLUGIN_API_VERSION, PLUGIN_API_VERSION - 1].filter(
	(v) => v >= 1
);
export const DEFAULT_TIMEOUT_MS = 3_000;
export const MAX_TIMEOUT_MS = 10_000;
/** A failure is retried after at most this long, whatever the provider's ttl. */
const MAX_FAILURE_TTL_MS = 15_000;
const MAX_EXEC_BYTES = 64 * 1024;
const MAX_VALUE_BYTES = 256 * 1024;
const ID = /^[a-z][a-z0-9-]{0,39}$/;
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const RANK: Record<Scope, number> = { fleet: 0, project: 1, task: 2 };

export interface RegistryHost {
	/** The current fleet, as the collector last read it. */
	fleet(): { projects: Project[]; tasks: TaskSummary[] };
	/** The worktree Firstmate recorded for a task, if any. */
	worktree(taskId: string): string | null;
	/** The plugins file, as last read. */
	config(): Promise<{ config: PluginConfig; error: string | null }>;
	configFile?: string | null;
	env?: NodeJS.ProcessEnv;
	now?: () => number;
}

export type { SlotQuery };

/** Why a manifest cannot be loaded, or null when it can. */
export function checkManifest(p: WheelhousePlugin, taken: ReadonlySet<string>): string | null {
	if (!SUPPORTED_API_VERSIONS.includes(p.apiVersion)) {
		return `it was written for plugin contract ${p.apiVersion}; this Wheelhouse supports ${SUPPORTED_API_VERSIONS.join(' and ')}.`;
	}
	if (!ID.test(p.id)) return `its id "${p.id}" is not lower-case letters, digits and dashes.`;
	if (taken.has(p.id)) return `another plugin already uses the id "${p.id}".`;
	if (!SEMVER.test(p.version)) return `its version "${p.version}" is not a semantic version.`;
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
	}
	return null;
}

/** What one provider call is about. */
interface Scope_ {
	project: Project | null;
	task: TaskSummary | null;
	projects: Project[];
	tasks: TaskSummary[];
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

	constructor(
		plugins: WheelhousePlugin[],
		private readonly host: RegistryHost
	) {
		this.now = host.now ?? Date.now;
		const taken = new Set<string>();
		for (const p of plugins) {
			const reason = checkManifest(p, taken);
			if (!reason) {
				taken.add(p.id);
				this.loaded.push(p);
			}
			this.statuses.push({
				id: p.id,
				name: p.name,
				version: p.version,
				apiVersion: p.apiVersion,
				state: reason ? 'refused' : 'loaded',
				reason: reason ? `Wheelhouse did not load ${p.name}: ${reason}` : null,
				slots: [...new Set(p.contributions.map((c) => c.slot))],
				enabledByDefault: p.enabledByDefault ?? false
			});
		}
	}

	status(): PluginStatus[] {
		return this.statuses;
	}

	async view(): Promise<PluginsView> {
		const { config, error } = await this.config();
		const enabled: Record<string, string[]> = {};
		for (const p of this.host.fleet().projects) {
			enabled[p.id] = this.loaded.filter((pl) => isEnabled(config, pl, p.id)).map((pl) => pl.id);
		}
		return {
			schema: 'wheelhouse-plugins.v1',
			supported: SUPPORTED_API_VERSIONS,
			config: { file: this.host.configFile ?? null, error },
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
			const projects = fleet.projects.filter((p) => isEnabled(config, plugin, p.id));
			const on =
				q.scope === 'fleet'
					? projects.length > 0
					: isEnabled(config, plugin, task?.projectId ?? project!.id);
			if (!on) continue;
			for (const c of plugin.contributions) {
				if (SLOT_SCOPE[c.slot] !== q.scope) continue;
				const provider = plugin.providers.find((p) => p.id === c.provider)!;
				jobs.push(this.fill(plugin, c, provider, { project, task, projects, fleet }));
			}
		}
		const entries = (await Promise.all(jobs)).filter((e): e is SlotEntry => e !== null);
		entries.sort((a, b) => a.order - b.order || a.key.localeCompare(b.key));
		return { schema: 'wheelhouse-slots.v1', entries };
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
		}
	): Promise<SlotEntry | null> {
		// A provider sees only as much as its own scope: a fleet provider in a task slot sees no task.
		const project = provider.scope === 'fleet' ? null : scope.project;
		const task = provider.scope === 'task' ? scope.task : null;
		const visible = new Set(scope.projects.map((p) => p.id));
		const tasks = project
			? scope.fleet.tasks.filter((t) => t.projectId === project.id)
			: scope.fleet.tasks.filter((t) => visible.has(t.projectId));
		const raw = await this.run(plugin, provider, {
			project,
			task,
			projects: scope.projects,
			tasks
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
		if (hit?.pending) return hit.pending;
		if (hit?.value && now - hit.at < hit.ttl) return Promise.resolve(hit.value);

		const pending = this.call(plugin, provider, scope).then((value) => {
			const ttl = value.available ? provider.ttlMs : Math.min(provider.ttlMs, MAX_FAILURE_TTL_MS);
			this.cache.set(key, { at: this.now(), ttl, value, pending: null });
			return value;
		});
		this.cache.set(key, { at: now, ttl: 0, value: hit?.value ?? null, pending });
		return pending;
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
		const ctx: ProviderContext = {
			project: scope.project,
			task: scope.task,
			projects: structuredClone(scope.projects),
			tasks: structuredClone(scope.tasks),
			signal: controller.signal,
			exec: (r) =>
				this.exec(r, scope, Math.max(1, timeoutMs - (Date.now() - started)), controller.signal),
			readFile: (rel, o) => this.readFile(rel, o, scope)
		};
		if (ctx.project) ctx.project = structuredClone(ctx.project);
		if (ctx.task) ctx.task = structuredClone(ctx.task);

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

	private root(which: 'project' | 'task', projectId: string | undefined, scope: Scope_) {
		const project =
			projectId === undefined ? scope.project : scope.projects.find((p) => p.id === projectId);
		const dir =
			which === 'project' ? project?.path : scope.task ? this.host.worktree(scope.task.id) : null;
		return dir && path.isAbsolute(dir) ? dir : null;
	}

	private async exec(
		r: ExecRequest,
		scope: Scope_,
		left: number,
		signal: AbortSignal
	): Promise<ExecResult> {
		if (signal.aborted) return { ok: false, reason: 'the plugin call timed out', stdout: '' };
		const cwd = this.root(r.cwd, r.project, scope);
		if (!cwd) return { ok: false, reason: `there is no ${r.cwd} directory to run in`, stdout: '' };
		if (!Array.isArray(r.argv) || !r.argv.length || r.argv.some((a) => typeof a !== 'string')) {
			return { ok: false, reason: 'argv must be a non-empty list of strings', stdout: '' };
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
			: { ok: false, reason: res.message, stdout: res.stdout };
	}

	private async readFile(
		rel: string,
		o: { root: 'project' | 'task'; maxBytes: number; project?: string },
		scope: Scope_
	): Promise<string | null> {
		const root = this.root(o.root, o.project, scope);
		if (!root || typeof rel !== 'string' || path.isAbsolute(rel)) return null;
		try {
			const base = await realpath(root);
			const file = await realpath(path.resolve(base, rel));
			if (file !== base && !file.startsWith(base + path.sep)) return null;
			const max = Math.max(0, Math.min(o.maxBytes, MAX_EXEC_BYTES));
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
