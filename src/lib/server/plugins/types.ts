import type { Render, Scope, Slot } from '../../plugins/types';
import type { Available, Project, TaskSummary } from '../../types';

/**
 * The server-side plugin contract ("panels and providers"). A plugin is
 * compiled into Wheelhouse: a manifest, providers that read data on the
 * server, and contributions that put a provider's output in a fixed UI slot.
 * Providers read only through ProviderContext; there is no way to write,
 * message Firstmate or control workers.
 */

/** The plugin contract version this file describes. */
export const PLUGIN_API_VERSION = 1;

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
	providers: Provider[];
	contributions: Contribution[];
}

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
	 * Run a command without a shell, in the project clone or the task worktree,
	 * with a minimal environment and bounded time and output. Read-only by
	 * contract: Wheelhouse does not sandbox it.
	 */
	exec(c: ExecRequest): Promise<ExecResult>;
	/**
	 * Read a file under the project clone (`project` names one of `ctx.projects`
	 * outside a project scope) or the task worktree; null if absent or outside it.
	 * Reads at most 64 KiB.
	 */
	readFile(
		rel: string,
		o: { root: 'project' | 'task'; maxBytes: number; project?: string }
	): Promise<string | null>;
	/**
	 * Files one of `tasks` changed against its base branch, including uncommitted
	 * and untracked ones, as Wheelhouse's task evidence reads them; null when
	 * Wheelhouse cannot tell (no worktree, or not one of `tasks`).
	 */
	changedFiles(taskId: string): Promise<string[] | null>;
	/** The plugin's `settings` from the captain's plugins file (empty when it has none). */
	settings: Record<string, unknown>;
	/** Aborted when the call times out. */
	signal: AbortSignal;
}

export interface ExecRequest {
	argv: string[];
	cwd: 'project' | 'task';
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
	 */
	render: Render;
}
