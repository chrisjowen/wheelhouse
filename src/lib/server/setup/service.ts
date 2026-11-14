import { existsSync, mkdirSync, statSync, accessSync, constants } from 'node:fs';
import path from 'node:path';
import {
	agentName,
	AGENT_KEY_NAMES,
	CLOUD_PRODUCT,
	defaultChoice,
	isKeyProvider,
	isReady,
	type AgentChoice
} from '../../agent';
import { parseHarness } from '../../harness';
import {
	FIRSTMATE_REPOSITORY,
	type CheckLine,
	type CheckReport,
	type ClaudeStatus,
	type DepItem,
	type FirstmateSessionViewLike,
	type InstallView,
	type LocationCheck,
	type PlatformView,
	type SetupPlugin,
	type SessionSetting,
	type SetupView,
	type AgentView,
	type ToolsReport
} from '../../setup';
import { checkCompatibility, type FirstmateInstall } from '../firstmate/install';
import { runBounded } from '../firstmate/exec';
import { defaultConfigDir } from '../plugins/config';
import { defaultPluginsDir } from '../plugins/installed';
import { bundledPluginsDir } from '../plugins/loader';
import { canRestart, restartSoon } from '../restart';
import { getRuntime, reconnectRuntime } from '../runtime';
import { which, type Run } from '../sessions/tmux';
import {
	readSavedBackend,
	resolveSessionBackend,
	writeSavedBackend,
	type SessionBackendName
} from '../sessions/choice';
import { checkHerdr, DEFAULT_HERDR_SESSION, HERDR_MIN_VERSION } from '../sessions/herdr';
import { defaultStateDir, isInside } from '../store/store';
import { VaultService } from '../vault';
import { agentStatus, installCommand, signInWithKey, testAgent, type OtherAgent } from './agents';
import { currentChoice, fixedHarness, writeSavedChoice } from './agentchoice';
import { readAnswers } from './answers';
import { markSignedIn } from './cloud';
import { claudeStatus, testClaude } from './claude';
import {
	checkTools,
	detectPlatform,
	npmWritable,
	oneClickSteps,
	remedy,
	stepsFor,
	type CommandEnv
} from './deps';
import { checkLocation, cloneFirstmate, defaultFirstmateDir, foundFirstmates } from './location';
import { setupPlugins, switchPlugin } from './plugins';
import { syncForServer } from '../material/server';
import type { PluginRegistry } from '../plugins/registry';
import { writeRemembered } from './remembered';
import { setupTerminals, setupWorkDir } from './terminal';

/**
 * The setup wizard's server side: one instance per process, behind
 * `/api/setup` (Wheelhouse's own page only, with its session token, from this
 * computer). Every command it runs is an argument array (never a shell), and
 * an install runs only Firstmate's own command for that tool, re-read here,
 * never one the page sends. With WHEELHOUSE_SETUP_DRY_RUN=1 an install only
 * says what it would run; cloning still clones, into the folder given.
 */

/** What happened to the agent's API key: `exists`, the vault already held its name and nothing changed. */
export interface AgentKeyResult {
	name: string;
	message: string;
	exists: boolean;
}

export type ActionResult<T> = { ok: true; value: T } | { ok: false; error: string };

export interface InstallOutcome {
	command: string;
	dryRun: boolean;
	output: string;
}

const INSTALL_TIMEOUT_MS = 10 * 60_000;
const tail = (s: string, n = 4000) => (s.length > n ? `…${s.slice(-n)}` : s);

export class SetupService {
	private env: NodeJS.ProcessEnv;
	private run: Run;
	private lastTools: ToolsReport | null = null;
	/** The last status of the chosen agent, and which choice it was for. */
	private lastAgent: { key: string; status: ClaudeStatus } | null = null;
	private busy: string | null = null;
	private skillMessage: string | null = null;
	private vault: Pick<VaultService, 'change'> | null;

	constructor(
		opts: { env?: NodeJS.ProcessEnv; run?: Run; vault?: Pick<VaultService, 'change'> } = {}
	) {
		this.env = opts.env ?? process.env;
		this.run = opts.run ?? runBounded;
		this.vault = opts.vault ?? null;
	}

	get dryRun(): boolean {
		return this.env.WHEELHOUSE_SETUP_DRY_RUN === '1';
	}

	private find = (name: string) => which(name, this.env.PATH);
	private get configDir() {
		return defaultConfigDir(this.env);
	}
	private get ownDirs() {
		return [defaultStateDir(this.env), this.configDir, defaultPluginsDir(this.env)];
	}
	private get repository() {
		return this.env.WHEELHOUSE_SETUP_REPOSITORY || FIRSTMATE_REPOSITORY;
	}
	platform(): PlatformView {
		return detectPlatform(process.platform, this.find);
	}
	private async commandEnv(): Promise<CommandEnv> {
		return {
			packageManager: this.platform().packageManager,
			npmWritable: await npmWritable(this.run, this.find('npm'), this.env)
		};
	}

	/** The Firstmate Wheelhouse is connected to now, and how it was found. */
	async current(): Promise<{
		install: InstallView | null;
		problem: string | null;
		canChoose: boolean;
	}> {
		const r = await getRuntime(this.env);
		if (!r.configured) return { install: null, problem: r.error, canChoose: true };
		return {
			install: { ...r.install, source: r.source },
			problem: null,
			canChoose: r.source === 'remembered'
		};
	}

	async view(): Promise<SetupView> {
		const cur = await this.current();
		const platform = this.platform();
		const git = this.find('git');
		const gitItem: DepItem = {
			tool: 'git',
			what: 'Clones Firstmate, and every project after it',
			status: git ? 'ok' : 'missing',
			detail: git ? null : 'Not installed',
			required: true,
			oneClick: null,
			terminal: [],
			link: 'https://git-scm.com/downloads',
			note: null
		};
		if (!git) {
			Object.assign(gitItem, remedy('git', 'brew install git', await this.commandEnv()));
			if (platform.os === 'macos' && platform.packageManager !== 'brew') {
				gitItem.terminal = ['xcode-select --install'];
			}
		}
		return {
			agent: this.agentView(),
			skillMessage: this.skillMessage,
			tool: {
				harness: parseHarness(this.env.WHEELHOUSE_HARNESS),
				installed: this.find(parseHarness(this.env.WHEELHOUSE_HARNESS)) !== null
			},
			schema: 'wheelhouse-setup.v1',
			platform,
			dryRun: this.dryRun,
			install: cur.install,
			problem: cur.problem,
			canChoose: cur.canChoose,
			defaultDir: defaultFirstmateDir(),
			found: foundFirstmates(this.env, process.cwd()),
			repository: this.repository,
			git: gitItem,
			tmux: Boolean(this.find('tmux')),
			session: await this.session(),
			canRestart: canRestart()
		};
	}

	/** What runs the Firstmate session, decided as the runtime decides it, with herdr's state. */
	async session(): Promise<SessionSetting> {
		const r = await getRuntime(this.env);
		const choice = resolveSessionBackend({
			env: this.env,
			configDir: this.configDir,
			homeDir: r.configured ? r.install.homeDir : null
		});
		const saved = readSavedBackend(this.configDir);
		const herdr = await checkHerdr(this.find, this.env, this.run);
		return {
			backend: choice.backend,
			source: choice.source,
			saved: saved.ok ? saved.backend : null,
			firstmate: choice.firstmate,
			herdrSession: choice.herdrSession || DEFAULT_HERDR_SESSION,
			warning: choice.warning,
			error: choice.error,
			herdr: {
				installed: herdr.path !== null,
				version: herdr.version,
				ok: herdr.ok,
				problem: herdr.problem
			},
			herdrMinVersion: HERDR_MIN_VERSION
		};
	}

	/**
	 * Keep the wizard's session backend (null: follow Firstmate's config/backend).
	 * A connected Wheelhouse restarts to use a different one; a session already
	 * running in the other backend keeps running there, untouched.
	 */
	async chooseBackend(
		backend: SessionBackendName | null
	): Promise<ActionResult<{ session: SessionSetting; restarting: boolean }>> {
		if (this.env.WHEELHOUSE_SESSION_BACKEND) {
			return {
				ok: false,
				error:
					'This Wheelhouse was started with --session-backend or WHEELHOUSE_SESSION_BACKEND, which wins over the choice here. Start it without them to choose here.'
			};
		}
		try {
			writeSavedBackend(this.configDir, backend);
		} catch (e) {
			return {
				ok: false,
				error: `Could not keep the choice in ${this.configDir}: ${(e as Error).message}`
			};
		}
		this.lastTools = null;
		const session = await this.session();
		const r = await getRuntime(this.env);
		if (
			!r.configured ||
			(r.firstmate.backend.label === session.backend && !r.firstmate.backendProblem)
		) {
			return { ok: true, value: { session, restarting: false } };
		}
		if (restartSoon()) return { ok: true, value: { session, restarting: true } };
		return {
			ok: false,
			error: `Saved. This Wheelhouse cannot restart itself; restart it to run Firstmate in ${session.backend}.`
		};
	}

	inspect(dir: string): LocationCheck {
		return checkLocation(dir, { ownDirs: this.ownDirs });
	}

	private async exclusive<T>(
		what: string,
		fn: () => Promise<ActionResult<T>>
	): Promise<ActionResult<T>> {
		if (this.busy) return { ok: false, error: `Wait for ${this.busy} to finish.` };
		this.busy = what;
		try {
			return await fn();
		} finally {
			this.busy = null;
		}
	}

	/** Clone Firstmate to a new or empty folder, then use it. */
	clone(dir: string): Promise<ActionResult<{ dir: string; output: string; restarting: boolean }>> {
		return this.exclusive('the clone', async () => {
			const cur = await this.current();
			if (!cur.canChoose) return { ok: false, error: this.fixedWhy(cur.install) };
			const git = this.find('git');
			if (!git) return { ok: false, error: 'Install git first: cloning needs it.' };
			const r = await cloneFirstmate(dir, {
				git,
				repository: this.repository,
				env: this.env,
				ownDirs: this.ownDirs,
				run: this.run
			});
			if (!r.ok) return r;
			const used = await this.connect(r.dir);
			if (!used.ok) return used;
			return {
				ok: true,
				value: { dir: r.dir, output: tail(r.output), restarting: used.value.restarting }
			};
		});
	}

	/** Use a Firstmate checkout already on this computer, as it is. */
	async use(dir: string): Promise<ActionResult<{ dir: string; restarting: boolean }>> {
		const cur = await this.current();
		if (!cur.canChoose) return { ok: false, error: this.fixedWhy(cur.install) };
		const at = this.inspect(dir);
		if (at.kind !== 'firstmate') {
			return {
				ok: false,
				error: at.kind === 'invalid' ? at.message : `${at.dir} is not a Firstmate checkout.`
			};
		}
		// A checkout that has never run has no state/ yet; Firstmate's own lock makes the same.
		try {
			mkdirSync(path.join(at.dir, 'state'), { recursive: true });
		} catch (e) {
			return { ok: false, error: `Could not make ${at.dir}/state: ${(e as Error).message}` };
		}
		const used = await this.connect(at.dir);
		return used.ok ? { ok: true, value: { dir: at.dir, restarting: used.value.restarting } } : used;
	}

	private fixedWhy(install: InstallView | null): string {
		return `This Wheelhouse was started for ${install?.firstmateDir ?? 'a Firstmate'} (${
			install?.source === 'flag' ? 'with --firstmate' : 'from the folder it ran in'
		}). To use another, start \`wheelhouse open --firstmate <dir>\` there.`;
	}

	/** The bundled skills, saying which review surface is on (the built-in until plugins are read). */
	private installSkill(r: { install: FirstmateInstall; plugins?: PluginRegistry }) {
		return syncForServer(r.install, this.env, r.plugins);
	}

	/** Remember `dir` and connect Wheelhouse to it: now, or by restarting when it used another. */
	private async connect(dir: string): Promise<ActionResult<{ restarting: boolean }>> {
		try {
			writeRemembered(this.configDir, { firstmate: dir, home: dir });
		} catch (e) {
			return {
				ok: false,
				error: `Could not remember the choice in ${this.configDir}: ${(e as Error).message}`
			};
		}
		this.lastTools = null;
		const r = await reconnectRuntime(this.env);
		if (!r.configured) return { ok: false, error: r.error };
		if (path.resolve(r.install.firstmateDir) === path.resolve(dir)) {
			if (!this.dryRun) this.skillMessage = (await this.installSkill(r)).message;
			return { ok: true, value: { restarting: false } };
		}
		if (restartSoon()) return { ok: true, value: { restarting: true } };
		return {
			ok: false,
			error: `Saved. This Wheelhouse cannot restart itself; restart it to use ${dir}.`
		};
	}

	private async install(): Promise<ActionResult<FirstmateInstall>> {
		const r = await getRuntime(this.env);
		return r.configured
			? { ok: true, value: r.install }
			: { ok: false, error: 'Choose where Firstmate lives first.' };
	}

	/** Firstmate's own bootstrap check, as the wizard's list of tools. */
	async tools(): Promise<ActionResult<ToolsReport>> {
		const at = await this.install();
		if (!at.ok) return at;
		const session = resolveSessionBackend({
			env: this.env,
			configDir: this.configDir,
			homeDir: at.value.homeDir
		});
		this.lastTools = await checkTools({
			firstmateDir: at.value.firstmateDir,
			homeDir: at.value.homeDir,
			env: this.env,
			platform: this.platform(),
			run: this.run,
			sessionBackend: session.backend
		});
		return { ok: true, value: this.lastTools };
	}

	/** Run `tool`'s one-click install, as Firstmate's check says it, after the captain agreed. */
	installTool(tool: string): Promise<ActionResult<InstallOutcome>> {
		return this.exclusive(`installing ${tool}`, async () => {
			const report = this.lastTools ?? (await this.tools().then((r) => (r.ok ? r.value : null)));
			if (!report) return { ok: false, error: 'Check the tools first.' };
			const plan = stepsFor(report, tool, await this.commandEnv());
			if (!plan)
				return {
					ok: false,
					error: `${tool} has no one-click install here; run its command in your terminal.`
				};
			const out = await this.runSteps(plan.command, plan.steps);
			this.lastTools = null;
			return out;
		});
	}

	private async runSteps(
		command: string,
		steps: string[][]
	): Promise<ActionResult<InstallOutcome>> {
		if (this.dryRun) {
			return {
				ok: true,
				value: { command, dryRun: true, output: `Dry run: would run ${command}` }
			};
		}
		let output = '';
		for (const [file, ...args] of steps) {
			const bin = this.find(file);
			if (!bin) return { ok: false, error: `${file} is not on PATH.` };
			const r = await this.run(bin, args, {
				env: this.env,
				timeoutMs: INSTALL_TIMEOUT_MS,
				maxOutputBytes: 4 * 1024 * 1024,
				tailBytes: 64 * 1024
			});
			output += `$ ${[file, ...args].join(' ')}\n${r.stdout}${r.stderr}\n`;
			if (!r.ok)
				return { ok: false, error: `${file} failed: ${tail((r.stderr || r.message).trim(), 600)}` };
		}
		return { ok: true, value: { command, dryRun: false, output: tail(output.trim()) } };
	}

	private agentOpts = async () => ({
		env: this.env,
		workDir: setupWorkDir(this.env),
		commandEnv: await this.commandEnv(),
		run: this.run
	});

	/** The agent and way to pay the wizard sets up now, or null (a harness it does not set up). */
	choice(): AgentChoice | null {
		return currentChoice(parseHarness(this.env.WHEELHOUSE_HARNESS), this.configDir);
	}

	agentView(): AgentView {
		const answers = readAnswers(this.configDir);
		return {
			choice: currentChoice(parseHarness(this.env.WHEELHOUSE_HARNESS), this.configDir, answers),
			cloud: answers.state === 'ok' ? { product: CLOUD_PRODUCT, answered: answers.choice } : null,
			answersProblem: answers.state === 'invalid' ? answers.problem : null,
			fixed: fixedHarness(this.env)
		};
	}

	private get cloud(): boolean {
		return readAnswers(this.configDir).state === 'ok';
	}

	/** On a cloud machine, keep that its sign-in step is done: its pages stop opening the wizard. */
	private signedIn(agent: string): void {
		if (!this.cloud) return;
		try {
			markSignedIn(defaultStateDir(this.env), agent);
		} catch {
			// Not kept: its pages open the wizard again, where the test can pass again.
		}
	}

	/**
	 * Choose the agent Firstmate runs in and how it is paid for. Kept in
	 * harness.json; a connected Wheelhouse running another agent restarts to
	 * use it (a session already running keeps running, untouched).
	 */
	async chooseAgent(
		c: AgentChoice
	): Promise<ActionResult<{ agent: AgentView; restarting: boolean }>> {
		const fixed = fixedHarness(this.env);
		if (fixed && c.agent !== parseHarness(this.env.WHEELHOUSE_HARNESS))
			return { ok: false, error: fixed };
		if (!isReady(c, this.cloud))
			return { ok: false, error: 'That way to pay for it is not offered yet.' };
		try {
			writeSavedChoice(this.configDir, c);
		} catch (e) {
			return {
				ok: false,
				error: `Could not keep the choice in ${this.configDir}: ${(e as Error).message}`
			};
		}
		this.env.WHEELHOUSE_HARNESS = c.agent;
		setupTerminals().closeAll('The agent changed.');
		const r = await getRuntime(this.env);
		if (!r.configured || r.firstmate.harness === c.agent)
			return { ok: true, value: { agent: this.agentView(), restarting: false } };
		if (restartSoon()) return { ok: true, value: { agent: this.agentView(), restarting: true } };
		return {
			ok: false,
			error: `Saved. This Wheelhouse cannot restart itself; restart it to run Firstmate in ${agentName(c.agent)}.`
		};
	}

	private static key = (c: AgentChoice) => `${c.agent}/${c.auth}/${c.provider}`;

	/** The chosen agent's status; a test already passed for this same agent and choice stays passed. */
	async agentStatus(): Promise<ClaudeStatus> {
		const c = this.choice() ?? defaultChoice('claude');
		const opts = await this.agentOpts();
		const s = c.agent === 'claude' ? await claudeStatus(opts) : await agentStatus(c.agent, opts);
		const last = this.lastAgent;
		if (
			last?.key === SetupService.key(c) &&
			last.status.signedIn &&
			last.status.path === s.path &&
			last.status.version === s.version
		) {
			return last.status;
		}
		this.lastAgent = { key: SetupService.key(c), status: s };
		return s;
	}

	installAgent(): Promise<ActionResult<{ outcome: InstallOutcome; status: ClaudeStatus }>> {
		const agent = this.choice()?.agent ?? 'claude';
		const name = agentName(agent);
		return this.exclusive(`installing ${name}`, async () => {
			const env = await this.commandEnv();
			const command = installCommand(agent);
			const steps = oneClickSteps(command, env);
			if (!steps) {
				return {
					ok: false,
					error: 'npm cannot install it here without sudo; run the command in your terminal.'
				};
			}
			const out = await this.runSteps(command, steps);
			if (!out.ok) return out;
			const status = await this.agentStatus();
			if (!out.value.dryRun && !status.installed) {
				return {
					ok: false,
					error: `npm finished, but \`${agent} --version\` does not answer: ${status.detail ?? `${agent} is not on PATH`}`
				};
			}
			return { ok: true, value: { outcome: out.value, status } };
		});
	}

	/** The tiny non-interactive test; once it passes, the sign-in terminal closes. */
	testAgent(): Promise<ActionResult<ClaudeStatus>> {
		const c = this.choice() ?? defaultChoice('claude');
		return this.exclusive(`the ${agentName(c.agent)} test`, async () => {
			if (setupTerminals().connections > 0) {
				setupTerminals().closeAll(`Checking ${agentName(c.agent)}.`);
			}
			const opts = await this.agentOpts();
			const status =
				c.agent === 'claude'
					? await testClaude(opts)
					: await testAgent({ ...c, agent: c.agent as OtherAgent }, opts);
			this.lastAgent = { key: SetupService.key(c), status };
			if (status.signedIn === true) this.signedIn(c.agent);
			return { ok: true, value: status };
		});
	}

	private vaultService(): Pick<VaultService, 'change'> {
		this.vault ??= new VaultService({
			cli: path.resolve(bundledPluginsDir(this.env), '..', 'dist', 'wh-vault.js'),
			configDir: this.configDir,
			env: this.env
		});
		return this.vault;
	}

	/**
	 * Take the chosen agent's API key: keep it in the vault under a name of
	 * the agent's own (WHEELHOUSE_AGENT_…, granted to no project, so no task
	 * gets it), then sign the agent in with it as its own login would. Without
	 * `replace`, a value already under that name is kept, and the answer says
	 * so (`exists`) for the page to ask first. The key is never sent back,
	 * logged or kept anywhere else.
	 */
	agentKey(value: string, replace = false): Promise<ActionResult<AgentKeyResult>> {
		const c = this.choice();
		return this.exclusive<AgentKeyResult>('the API key', async () => {
			if (!c || c.auth !== 'apikey' || !isKeyProvider(c.provider) || !isReady(c, this.cloud))
				return { ok: false, error: 'Choose an agent paid for with an API key first.' };
			if (c.agent === 'claude')
				return { ok: false, error: 'Claude Code with an API key is not offered yet.' };
			const key = value.trim();
			if (!key || /\s/.test(key)) return { ok: false, error: 'Paste the API key, on one line.' };
			const name = AGENT_KEY_NAMES[c.provider];
			const stored = await this.vaultService().change({
				action: 'set',
				name,
				value: key,
				projects: [],
				replace
			});
			if (!stored.ok && stored.status === 409 && !replace)
				return { ok: true, value: { name, message: stored.message, exists: true } };
			if (!stored.ok) return { ok: false, error: stored.message };
			const agent = c.agent as OtherAgent;
			const login = await signInWithKey({ ...c, agent }, c.provider, key, await this.agentOpts());
			if (!login.ok) return { ok: false, error: `${stored.message} ${login.error}` };
			this.lastAgent = null;
			return {
				ok: true,
				value: {
					name,
					message: `${stored.message} ${agentName(agent)} is signed in with it.`,
					exists: false
				}
			};
		});
	}

	/** Firstmate's own checks and Wheelhouse's, against the chosen home. */
	async check(): Promise<ActionResult<CheckReport>> {
		const at = await this.install();
		if (!at.ok) return at;
		const install = at.value;
		const lines: CheckLine[] = [];
		const compat = await checkCompatibility(install);
		lines.push({
			label: 'Wheelhouse can read this Firstmate',
			ok: compat.compatible,
			detail: compat.compatible
				? compat.firstmateVersion
					? `Firstmate ${compat.firstmateVersion}`
					: null
				: compat.problems.join('; ')
		});
		const tools = await this.tools();
		const missing = tools.ok
			? tools.value.items.filter((i) => i.required && i.status !== 'ok').map((i) => i.tool)
			: [];
		lines.push({
			label: 'Firstmate’s bootstrap check (fm-bootstrap.sh)',
			ok: tools.ok && !tools.value.error && missing.length === 0,
			detail: !tools.ok
				? tools.error
				: (tools.value.error ??
					(missing.length ? `Still needs: ${missing.join(', ')}` : 'Every tool it needs is here'))
		});
		const r = await getRuntime(this.env);
		if (r.configured) {
			const ready = await r.adapter.ready();
			lines.push({
				label: 'Firstmate’s readiness check (fm-inbox.sh ready)',
				ok: ready.ok,
				detail: ready.ok ? `Session lock: ${ready.value.lock.state}` : ready.error.message
			});
		}
		const state = path.join(install.homeDir, 'state');
		lines.push({
			label: 'Firstmate’s home can be written',
			ok: writable(state),
			detail: state
		});
		const inside = this.ownDirs.filter((d) => isInside(d, install.homeDir));
		lines.push({
			label: 'Wheelhouse keeps its own records outside the home',
			ok: inside.length === 0,
			detail: inside.length ? `Inside it: ${inside.join(', ')}` : null
		});
		const session = await this.session();
		if (session.error) {
			lines.push({ label: 'The session backend setting', ok: false, detail: session.error });
		} else if (session.backend === 'herdr') {
			lines.push({
				label: `herdr ${HERDR_MIN_VERSION} or newer, which Wheelhouse runs the Firstmate session in (experimental)`,
				ok: session.herdr.ok,
				detail: session.herdr.ok ? `herdr ${session.herdr.version}` : session.herdr.problem
			});
		} else {
			const tmux = this.find('tmux');
			lines.push({
				label: 'tmux, which Wheelhouse runs the Firstmate session in',
				ok: Boolean(tmux),
				detail: tmux ?? 'Not installed'
			});
		}
		const harness = parseHarness(this.env.WHEELHOUSE_HARNESS);
		if (this.choice()) {
			const name = agentName(this.choice()!.agent);
			const agent = await this.agentStatus();
			lines.push({
				label: `${name} is signed in and answers`,
				ok: agent.signedIn === true,
				detail:
					agent.signedIn === true
						? (agent.version ?? null)
						: (agent.detail ?? `Not tested yet: test it in the ${name} step`)
			});
		} else {
			lines.push({
				label: `${harness} is installed`,
				ok: this.find(harness) !== null,
				detail: this.find(harness) ?? 'Install this tool and sign in using its own terminal.'
			});
		}
		return {
			ok: true,
			value: { ok: lines.every((l) => l.ok), lines, checkedAt: new Date().toISOString() }
		};
	}

	private pluginOpts = async () => {
		const r = await getRuntime(this.env);
		return {
			bundledDir: bundledPluginsDir(this.env),
			configDir: this.configDir,
			pluginsDir: defaultPluginsDir(this.env),
			homeDir: r.configured ? r.install.homeDir : null
		};
	};

	async plugins(): Promise<SetupPlugin[]> {
		return setupPlugins(await this.pluginOpts());
	}

	async switchPlugin(id: string, on: boolean): Promise<ActionResult<SetupPlugin[]>> {
		const opts = await this.pluginOpts();
		const r = await switchPlugin(opts, id, on);
		return r.ok ? { ok: true, value: await setupPlugins(opts) } : r;
	}

	/** Start Firstmate (never a second session), and close the setup terminal. */
	async finish(): Promise<ActionResult<FirstmateSessionViewLike>> {
		setupTerminals().closeAll('Setup is finished.');
		const r = await reconnectRuntime(this.env);
		if (!r.configured) return { ok: false, error: r.error };
		if (!this.dryRun) this.skillMessage = (await this.installSkill(r)).message;
		const view = await r.firstmate.ensure();
		void r.chat.refresh();
		if (view.state === 'unavailable')
			return { ok: false, error: view.reason ?? 'Firstmate cannot start here.' };
		this.signedIn(parseHarness(this.env.WHEELHOUSE_HARNESS));
		return { ok: true, value: { state: view.state, reason: view.reason, attach: view.attach } };
	}
}

function writable(dir: string): boolean {
	try {
		if (!existsSync(dir) || !statSync(dir).isDirectory()) return false;
		accessSync(dir, constants.W_OK);
		return true;
	} catch {
		return false;
	}
}

const KEY = Symbol.for('wheelhouse.setup');
const g = globalThis as unknown as Record<symbol, SetupService | undefined>;

export function setupService(): SetupService {
	g[KEY] ??= new SetupService();
	return g[KEY];
}
