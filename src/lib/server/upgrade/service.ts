import { defaultConfigDir } from '../plugins/config';
import {
	inspect,
	inspectUpdate,
	install,
	update,
	type Inspected,
	type Outcome,
	type PluginCliDeps
} from '../plugins/install';
import { defaultPluginsDir } from '../plugins/installed';
import { checkPlugins, type PluginUpdatesView, type UpdateCheckDeps } from '../plugins/updates';
import { canRestart, restartSoon } from '../restart';
import type { UpdateCheck, UpgradeJob, WheelhouseUpdateView } from '../../updates';
import { checkClone, upgradeClone, type CloneDeps } from './clone';

/**
 * What the pages ask of Wheelhouse about new versions: whether Wheelhouse
 * itself or an installed plugin has one, upgrading or updating to it, and
 * installing a plugin from GitHub. Checks are kept for CHECK_EVERY_MS and
 * redone when a page asks after that (or the captain asks now). One change at
 * a time: an upgrade, install or update refuses while another runs. Each
 * change ends by restarting this Wheelhouse, which its watcher starts again.
 * The routes that call these are session-token POSTs (hooks.server.ts).
 */

export const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

export interface ServiceDeps {
	env: NodeJS.ProcessEnv;
	clone?: Omit<CloneDeps, 'dir'>;
	plugins?: UpdateCheckDeps & Pick<PluginCliDeps, 'gitUrl'>;
	busy?: () => Promise<string[]>;
	now?: () => number;
	log?: (line: string) => void;
}

interface State {
	check: UpdateCheck | null;
	checking: Promise<UpdateCheck> | null;
	job: UpgradeJob | null;
	plugins: PluginUpdatesView | null;
	pluginsChecking: Promise<PluginUpdatesView> | null;
	/** What change is under way, if any. */
	changing: string | null;
}

const fresh = (): State => ({
	check: null,
	checking: null,
	job: null,
	plugins: null,
	pluginsChecking: null,
	changing: null
});

export class UpdateService {
	private s: State = fresh();
	constructor(private deps: ServiceDeps) {}

	private now = () => this.deps.now?.() ?? Date.now();
	private log = (line: string) => (this.deps.log ?? console.log)(line);
	private stale = (at: string | null | undefined) =>
		!at || this.now() - Date.parse(at) >= CHECK_EVERY_MS;

	/** The directory Wheelhouse runs from, as `wheelhouse open` names it. */
	installDir(): string | null {
		return this.deps.env.WHEELHOUSE_INSTALL_DIR || null;
	}

	private cloneDeps(dir: string): CloneDeps {
		return { now: () => new Date(this.now()), ...this.deps.clone, dir };
	}

	private pluginDeps(): PluginCliDeps {
		return {
			dir: defaultPluginsDir(this.deps.env),
			configDir: defaultConfigDir(this.deps.env),
			...this.deps.plugins,
			confirm: async () => true,
			// The page restarts this Wheelhouse itself once the change is kept.
			restart: async () => ({ restarted: [], failed: [], kept: [] }),
			log: () => {}
		};
	}

	/** Check Wheelhouse now; a check already under way is shared. */
	checkWheelhouse(): Promise<UpdateCheck> {
		if (this.s.checking) return this.s.checking;
		const dir = this.installDir();
		const run = dir
			? checkClone(this.cloneDeps(dir))
			: Promise.resolve<UpdateCheck>({
					schema: 'wheelhouse-update.v1',
					checkedAt: new Date(this.now()).toISOString(),
					state: 'unsupported',
					reason:
						'this Wheelhouse was not started by `wheelhouse open`, so it does not know where it is installed',
					dir: '',
					repository: null,
					branch: null,
					current: { commit: null, version: null },
					latest: null,
					commits: [],
					behind: 0,
					changes: []
				});
		this.s.checking = run.then((c) => (this.s.check = c)).finally(() => (this.s.checking = null));
		return this.s.checking;
	}

	/** The captain asked to check again: that also puts a failed upgrade behind them. */
	checkWheelhouseNow(): Promise<UpdateCheck> {
		if (this.s.job?.state === 'failed') this.s.job = null;
		return this.checkWheelhouse();
	}

	/** Wheelhouse's state; starts a check in the background when the last one is stale. */
	async wheelhouse(): Promise<WheelhouseUpdateView> {
		if (!this.s.checking && !this.s.changing && this.stale(this.s.check?.checkedAt)) {
			void this.checkWheelhouse().catch(() => {});
		}
		return {
			schema: 'wheelhouse-self-update.v1',
			check: this.s.check,
			checking: this.s.checking !== null,
			job: this.s.job,
			canRestart: canRestart(),
			busy: (await this.deps.busy?.()) ?? []
		};
	}

	/** Why a change cannot start now, or null. */
	private refuseChange(): string | null {
		if (this.s.changing) return `Wait for ${this.s.changing} to finish.`;
		if (!canRestart()) {
			return 'This Wheelhouse was not started by `wheelhouse open`, so it cannot restart itself to load a change.';
		}
		return null;
	}

	/**
	 * Start upgrading Wheelhouse: returns at once (or why it cannot start), and
	 * the job's progress shows in `wheelhouse()`. Ends by restarting.
	 */
	startUpgrade(): { ok: true } | { ok: false; error: string } {
		const refused = this.refuseChange();
		if (refused) return { ok: false, error: refused };
		const dir = this.installDir();
		if (!dir) return { ok: false, error: 'This Wheelhouse does not know where it is installed.' };
		this.s.changing = 'the Wheelhouse upgrade';
		const job: UpgradeJob = {
			state: 'running',
			step: 'fetch',
			to: null,
			error: null,
			output: null,
			startedAt: new Date(this.now()).toISOString()
		};
		this.s.job = job;
		this.log('Upgrading Wheelhouse…');
		void upgradeClone(this.cloneDeps(dir), (step) => {
			job.step = step;
		})
			.then((r) => {
				if (r.check) this.s.check = r.check;
				if (!r.ok) {
					job.state = 'failed';
					job.error = r.error;
					job.output = r.output.slice(-4000) || null;
					this.log(`Wheelhouse was not upgraded: ${r.error}.`);
					return;
				}
				job.to = r.to;
				job.step = 'restart';
				job.state = 'restarting';
				this.log(`Upgraded Wheelhouse to ${r.to.slice(0, 7)}; restarting.`);
				restartSoon();
			})
			.catch((e: Error) => {
				job.state = 'failed';
				job.error = e.message;
			})
			.finally(() => {
				if (job.state === 'failed') this.s.changing = null;
			});
		return { ok: true };
	}

	/** Check every installed plugin now; a check under way is shared. */
	checkPlugins(): Promise<PluginUpdatesView> {
		if (this.s.pluginsChecking) return this.s.pluginsChecking;
		this.s.pluginsChecking = checkPlugins(defaultPluginsDir(this.deps.env), {
			...this.deps.plugins,
			now: () => new Date(this.now())
		})
			.then((v) => (this.s.plugins = v))
			.finally(() => (this.s.pluginsChecking = null));
		return this.s.pluginsChecking;
	}

	/** The installed plugins' update state; checks in the background when stale. */
	async plugins(): Promise<PluginUpdatesView & { checking: boolean; busy: string[] }> {
		if (!this.s.pluginsChecking && this.stale(this.s.plugins?.checkedAt)) {
			void this.checkPlugins().catch(() => {});
		}
		return {
			...(this.s.plugins ?? {
				schema: 'wheelhouse-plugin-updates.v1',
				checkedAt: null,
				plugins: [],
				error: null
			}),
			checking: this.s.pluginsChecking !== null,
			busy: (await this.deps.busy?.()) ?? []
		};
	}

	inspectInstall(repo: string, ref: string | null): Promise<Inspected> {
		return inspect(ref ? `${repo}@${ref}` : repo, this.pluginDeps());
	}

	/** `ref` moves it to that tag, branch or commit; null keeps the one it was installed from. */
	inspectUpdate(id: string, ref: string | null): Promise<Inspected> {
		return inspectUpdate(id, this.pluginDeps(), ref ? { ref } : {});
	}

	/** Install what a look-up showed (exactly that commit), keep its settings, then restart. */
	installPlugin(o: {
		repo: string;
		ref: string | null;
		commit: string;
		settings: Record<string, string>;
	}): Promise<ChangeOutcome> {
		return this.change(`installing ${o.repo}`, () =>
			install(o.ref ? `${o.repo}@${o.ref}` : o.repo, this.pluginDeps(), {
				yes: true,
				expect: o.commit,
				settings: pairs(o.settings)
			})
		);
	}

	/** Update `id` to what a look-up showed (exactly that commit), keep new settings, then restart. */
	updatePlugin(
		id: string,
		o: { ref: string | null; commit: string; settings: Record<string, string> }
	): Promise<ChangeOutcome> {
		return this.change(`updating ${id}`, () =>
			update(id, this.pluginDeps(), {
				yes: true,
				expect: o.commit,
				...(o.ref ? { ref: o.ref } : {}),
				settings: pairs(o.settings)
			})
		);
	}

	private async change(what: string, work: () => Promise<Outcome>): Promise<ChangeOutcome> {
		const refused = this.refuseChange();
		if (refused) return { ok: false, error: refused };
		this.s.changing = what;
		let r: Outcome;
		try {
			r = await work();
		} catch (e) {
			this.s.changing = null;
			throw e;
		}
		if (!r.ok) {
			this.s.changing = null;
			return r;
		}
		// `changing` stays set: nothing else starts before this server closes.
		this.s.plugins = null;
		this.log(`Wheelhouse is restarting after ${what}.`);
		restartSoon();
		return { ok: true, restarting: true };
	}

	/** Forget everything (tests). */
	reset(): void {
		this.s = fresh();
	}
}

export type ChangeOutcome = { ok: true; restarting: boolean } | { ok: false; error: string };

const pairs = (settings: Record<string, string>) =>
	Object.entries(settings).map(([k, v]) => `${k}=${v}`);

const KEY = Symbol.for('wheelhouse.updates');
const g = globalThis as unknown as Record<symbol, UpdateService | undefined>;

/** The one update service for this server process. */
export function updateService(): UpdateService {
	g[KEY] ??= new UpdateService({
		env: process.env,
		busy: async () => (await import('../runtime')).busyRuntime()
	});
	return g[KEY];
}
