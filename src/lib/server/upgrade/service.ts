import { defaultConfigDir } from '../plugins/config';
import {
	inspect,
	inspectUpdate,
	install,
	setEnabled,
	update,
	type Inspected,
	type Outcome,
	type PluginCliDeps
} from '../plugins/install';
import { defaultPluginsDir } from '../plugins/installed';
import { checkPlugins, type PluginUpdatesView, type UpdateCheckDeps } from '../plugins/updates';
import { canRestart, restartSoon } from '../restart';
import type { UpdateCheck, UpdateSource, UpgradeJob, WheelhouseUpdateView } from '../../updates';
import type { InstallKind } from './kind';
import { checkClone, upgradeClone, type CloneDeps } from './clone';
import { detectInstallKind } from './kind';
import { checkNpm, upgradeNpm, type NpmRun } from './npm';
import { updateDir, UpdateSettings } from './settings';

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
	/** Runs npm for the published source; tests stand one in. */
	npm?: NpmRun;
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
	/** Cached install kind and source. */
	installKind: InstallKind | null;
	source: UpdateSource | null;
}

const fresh = (): State => ({
	check: null,
	checking: null,
	job: null,
	plugins: null,
	pluginsChecking: null,
	changing: null,
	installKind: null,
	source: null
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

	private configDir(): string {
		return defaultConfigDir(this.deps.env);
	}

	private updateSettings(): UpdateSettings {
		return new UpdateSettings(updateDir(this.configDir()));
	}

	/** Read the chosen update source (default 'published'). */
	async readSource(): Promise<UpdateSource> {
		const { settings } = await this.updateSettings().read();
		return settings.source;
	}

	/**
	 * Switch the update source: reinstall from npm (published) or bring the
	 * clone up to date (github), then save the choice and restart. Nothing is
	 * saved when the switch cannot be made.
	 */
	async setSource(source: UpdateSource): Promise<{ ok: true } | { ok: false; error: string }> {
		const refused = this.refuseChange();
		if (refused) return { ok: false, error: refused };
		this.s.changing = 'changing the update source';
		let error: string | null;
		try {
			if ((await this.readSource()) === source) {
				this.s.changing = null;
				return { ok: true };
			}
			error = await this.switchSource(source);
		} catch (e) {
			error = (e as Error).message;
		}
		if (error) {
			this.s.changing = null;
			return { ok: false, error };
		}
		this.s.source = source;
		this.s.check = null;
		this.log(`Wheelhouse is restarting after switching the update source to ${source}.`);
		restartSoon();
		return { ok: true };
	}

	/** Reinstall or bring the clone up to date, then save the source; why it failed, or null. */
	private async switchSource(source: UpdateSource): Promise<string | null> {
		const dir = this.installDir();
		if (!dir) return 'This Wheelhouse does not know where it is installed.';
		if (source === 'published') {
			const r = await upgradeNpm(dir, null, this.deps.npm);
			if (!r.ok) return r.error;
		} else {
			if ((await this.setup()).kind !== 'clone') return NOT_A_CLONE;
			const r = await upgradeClone(this.cloneDeps(dir));
			if (!r.ok && r.check?.state !== 'current') return r.error;
		}
		await this.updateSettings().update((s) => (s.source = source));
		return null;
	}

	/** The chosen source and how this Wheelhouse is installed (cached). */
	private async setup(): Promise<{ source: UpdateSource; kind: InstallKind }> {
		this.s.source ??= await this.readSource();
		const dir = this.installDir();
		this.s.installKind ??= dir ? (await detectInstallKind(dir)).kind : 'unknown';
		return { source: this.s.source, kind: this.s.installKind };
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

	/** Check Wheelhouse now from the chosen source; a check already under way is shared. */
	checkWheelhouse(): Promise<UpdateCheck> {
		if (this.s.checking) return this.s.checking;
		this.s.checking = this.runCheck()
			.then((c) => (this.s.check = c))
			.finally(() => (this.s.checking = null));
		return this.s.checking;
	}

	private async runCheck(): Promise<UpdateCheck> {
		const dir = this.installDir();
		if (!dir) {
			return this.unsupported(
				'',
				'this Wheelhouse was not started by `wheelhouse open`, so it does not know where it is installed'
			);
		}
		const { source, kind } = await this.setup();
		if (source === 'github') return checkClone(this.cloneDeps(dir));
		if (kind === 'clone') return this.unsupported(dir, PUBLISHED_ON_CLONE);
		return checkNpm(dir, this.deps.npm, () => new Date(this.now()));
	}

	private unsupported(dir: string, reason: string): UpdateCheck {
		return {
			schema: 'wheelhouse-update.v1',
			checkedAt: new Date(this.now()).toISOString(),
			state: 'unsupported',
			reason,
			dir,
			repository: null,
			branch: null,
			current: { commit: null, version: null },
			latest: null,
			commits: [],
			behind: 0,
			changes: []
		};
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
		const { source, kind } = await this.setup();
		return {
			schema: 'wheelhouse-self-update.v1',
			source,
			installKind: kind,
			mismatch:
				(source === 'published' && kind === 'clone') || (source === 'github' && kind === 'npm'),
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
	 * Start upgrading Wheelhouse from the chosen source (published: npm install
	 * -g; github: fast-forward the clone): answers once it has started (or why
	 * it cannot), and the job's progress shows in `wheelhouse()`. Ends by restarting.
	 */
	async startUpgrade(): Promise<{ ok: true } | { ok: false; error: string }> {
		const refused = this.refuseChange();
		if (refused) return { ok: false, error: refused };
		const dir = this.installDir();
		if (!dir) return { ok: false, error: 'This Wheelhouse does not know where it is installed.' };
		this.s.changing = 'the Wheelhouse upgrade';
		let setup: { source: UpdateSource; kind: InstallKind };
		try {
			setup = await this.setup();
		} catch (e) {
			this.s.changing = null;
			return { ok: false, error: (e as Error).message };
		}
		if (setup.source === 'published' && setup.kind === 'clone') {
			this.s.changing = null;
			return { ok: false, error: PUBLISHED_ON_CLONE };
		}
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
		const work: Promise<
			| { ok: true; to: string; check: UpdateCheck | null }
			| { ok: false; error: string; output: string; check: UpdateCheck | null }
		> =
			setup.source === 'published'
				? upgradeNpm(dir, this.s.check?.latest?.version ?? null, this.deps.npm).then((r) => ({
						...r,
						check: null
					}))
				: upgradeClone(this.cloneDeps(dir), (step) => {
						job.step = step;
					});
		void work
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
				this.log(
					`Upgraded Wheelhouse to ${setup.source === 'published' ? r.to : r.to.slice(0, 7)}; restarting.`
				);
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

	/** Turn an installed plugin that is off back on (as `wheelhouse plugin enable`), then restart to load it. */
	loadPlugin(id: string): Promise<ChangeOutcome> {
		return this.change(`turning on ${id}`, () =>
			setEnabled(id, true, this.pluginDeps(), { yes: true })
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

const NOT_A_CLONE =
	'Wheelhouse is not running from a git clone. Clone it and run from the clone to use GitHub source.';
const PUBLISHED_ON_CLONE =
	'Wheelhouse runs from a git clone but the update source is Published release; choose GitHub source in Settings → Update, or install it from npm';

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
