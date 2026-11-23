import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command, InvalidArgumentError } from 'commander';
import { defaultConfigDir } from '../src/lib/server/plugins/config';
import { defaultPluginsDir } from '../src/lib/server/plugins/installed';
import type { RestartOutcome } from '../src/lib/server/plugins/install';
import {
	checkClone,
	upgradeClone,
	type CloneDeps,
	type Run,
	type UpdateCheck
} from '../src/lib/server/upgrade/clone';
import { detectInstallKind } from '../src/lib/server/upgrade/kind';
import { checkNpm, runNpm, upgradeNpm, type NpmRun } from '../src/lib/server/upgrade/npm';
import { updateDir, UpdateSettings } from '../src/lib/server/upgrade/settings';
import { UPGRADE_STEPS, type UpdateSource, type UpgradeJob } from '../src/lib/updates';
import {
	act,
	CliError,
	Client,
	defaultAgentDeps,
	EXIT,
	findInstance,
	usageExits,
	waitBack,
	type AgentDeps
} from './agent';
import { askTerminal } from './plugin';
import { requestRestart } from './running';

/**
 * `wheelhouse upgrade`: upgrade Wheelhouse from its update source, published
 * (the npm package) or github (its clone), as the Settings → Update page does.
 * With Wheelhouse running, the running server does it (it knows its source and
 * how it is installed), says what a restart would stop, restarts and comes
 * back on the new version; `--source` switches the source the same way. With
 * none running, it upgrades in place: `npm install -g` for the published
 * package, or, for a git clone, fast-forward to the newest commits on its
 * origin's default branch, `npm ci` and `npm run build`. A clone with local
 * changes, on another branch or with commits of its own is refused and left
 * exactly as it is: nothing is reset, stashed or merged.
 */

export interface UpgradeCliDeps {
	/** The directory Wheelhouse runs from. */
	dir: string;
	git?: CloneDeps['git'];
	run?: Run;
	confirm(question: string): Promise<boolean>;
	restart(proceed: (url: string, busy: string[]) => Promise<boolean>): Promise<RestartOutcome>;
	log(line: string): void;
}

/** The checkout this CLI runs from: dist/cli.js → its parent. */
export function installDir(): string {
	return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
}

/** npm with its output on the terminal. */
const runInherit: Run = (cmd, args, cwd) =>
	new Promise((resolve) => {
		const child = spawn(cmd, args, { cwd, stdio: 'inherit' });
		child.on('error', (e) => resolve({ code: 1, output: e.message }));
		child.on('exit', (code) => resolve({ code: code ?? 1, output: '' }));
	});

const short = (c: string | null | undefined) => (c ? c.slice(0, 7) : 'unknown');
const versionOf = (v: { version: string | null; commit: string | null } | null) =>
	v ? `${v.version ?? '?'} (${short(v.commit)})` : 'unknown';

function describe(c: UpdateCheck, log: (l: string) => void) {
	const from = c.repository ?? 'origin';
	// The published package: a version on npm, no branch or commits.
	if (!c.branch && (c.state === 'current' || c.state === 'available')) {
		log(
			c.state === 'current'
				? `Wheelhouse ${c.current.version ?? '?'} is the newest on npm.`
				: `npm has Wheelhouse ${c.latest?.version ?? '?'} (this is ${c.current.version ?? 'unknown'}).`
		);
		return;
	}
	if (c.state === 'current') {
		log(`Wheelhouse ${versionOf(c.current)} is up to date with ${from} ${c.branch}.`);
		return;
	}
	if (c.state === 'unsupported' || c.state === 'error') return;
	log(
		`${from} ${c.branch} has ${c.behind} new commit${c.behind === 1 ? '' : 's'}: Wheelhouse ${versionOf(c.current)} → ${versionOf(c.latest)}`
	);
	for (const x of c.commits) log(`  ${short(x.sha)}  ${x.subject}`);
	if (c.behind > c.commits.length) log(`  … and ${c.behind - c.commits.length} more`);
}

export async function upgrade(
	deps: UpgradeCliDeps,
	o: { yes?: boolean; check?: boolean } = {}
): Promise<boolean> {
	const cloneDeps = { dir: deps.dir, git: deps.git, run: deps.run ?? runInherit };
	deps.log(`Checking ${deps.dir} for a newer Wheelhouse…`);
	const c = await checkClone(cloneDeps);
	describe(c, deps.log);
	if (c.state === 'current') return true;
	if (c.state !== 'available') {
		deps.log(`wheelhouse: ${c.reason}.`);
		for (const ch of c.changes) deps.log(`  ${ch}`);
		if (c.state === 'refused') deps.log('Nothing was changed.');
		return false;
	}
	if (o.check) return true;
	if (!o.yes && !(await deps.confirm('Upgrade Wheelhouse now?'))) {
		deps.log('Not upgraded.');
		return false;
	}
	const label = Object.fromEntries(UPGRADE_STEPS.map((s) => [s.step, s.label]));
	const r = await upgradeClone(cloneDeps, (step) => deps.log(`${label[step]}…`));
	if (!r.ok) {
		deps.log(`wheelhouse: ${r.error}.`);
		return false;
	}
	deps.log(`Upgraded Wheelhouse to ${versionOf(r.check.latest)}.`);
	const restarted = await deps.restart(async (url, busy) => {
		deps.log(`Restarting Wheelhouse at ${url} stops what it is running:`);
		for (const b of busy) deps.log(`  - ${b}`);
		return o.yes || deps.confirm('Restart it now?');
	});
	for (const url of restarted.restarted) deps.log(`Restarting Wheelhouse at ${url}.`);
	for (const url of restarted.kept) {
		deps.log(`Left Wheelhouse at ${url} running the old version; restart it to use the new one.`);
	}
	for (const f of restarted.failed) {
		deps.log(
			`Could not restart Wheelhouse at ${f.url} (${f.reason}); restart it to use the new one.`
		);
	}
	if (!restarted.restarted.length && !restarted.kept.length && !restarted.failed.length) {
		deps.log('Wheelhouse is not running; the new version starts with `wheelhouse open`.');
	}
	return true;
}

/** Upgrade the published package in place, with no Wheelhouse running. */
async function upgradeNpmHere(
	deps: UpgradeCliDeps,
	o: { yes?: boolean; check?: boolean }
): Promise<boolean> {
	// The check reads npm's answer; the install shows npm's output on the terminal.
	const ask: NpmRun = deps.run ? (cmd, args, cwd) => deps.run!(cmd, args, cwd ?? deps.dir) : runNpm;
	const inherit = deps.run ?? runInherit;
	const run: NpmRun = (cmd, args, cwd) => inherit(cmd, args, cwd ?? deps.dir);
	const c = await checkNpm(deps.dir, ask);
	describe(c, deps.log);
	if (c.state === 'current') return true;
	if (c.state !== 'available') {
		deps.log(`wheelhouse: ${c.reason}.`);
		return false;
	}
	if (o.check) return true;
	if (!o.yes && !(await deps.confirm('Upgrade Wheelhouse now?'))) {
		deps.log('Not upgraded.');
		return false;
	}
	const r = await upgradeNpm(deps.dir, c.latest?.version ?? null, run);
	if (!r.ok) {
		deps.log(`wheelhouse: ${r.error}.`);
		return false;
	}
	deps.log(`Upgraded Wheelhouse to ${r.to}; it starts with \`wheelhouse open\`.`);
	return true;
}

interface UpdateView {
	source: UpdateSource;
	installKind: string;
	mismatch: boolean;
	check: UpdateCheck | null;
	job: UpgradeJob | null;
	canRestart: boolean;
	busy: string[];
}

/** Follow the running server's upgrade job until it fails or Wheelhouse is back. */
async function follow(client: Client, deps: AgentDeps): Promise<void> {
	let said = '';
	const end = Date.now() + 30 * 60_000;
	while (Date.now() < end) {
		let job: UpgradeJob | null;
		try {
			job = (await client.get<UpdateView>('/api/wheelhouse/update')).job;
		} catch {
			break; // gone: restarting
		}
		if (!job) break;
		const label = job.steps.find((s) => s.step === job.step)?.label ?? job.step;
		if (label !== said) deps.log(`${label}…`);
		said = label;
		if (job.state === 'failed') {
			if (job.output)
				for (const l of job.output.trimEnd().split('\n').slice(-20)) deps.log(`  ${l}`);
			throw new CliError(`the upgrade failed: ${job.error ?? 'unknown error'}`);
		}
		if (job.state === 'restarting') break;
		await deps.sleep(1000);
	}
	const version = await waitBack(client, deps, { ms: 10 * 60_000 });
	if (!version)
		throw new CliError(`Wheelhouse at ${client.url} did not come back; see its terminal`);
	deps.log(`Wheelhouse ${version} is running at ${client.url}.`);
}

/** Upgrade (or switch the source of) a running Wheelhouse through its own server. */
export async function upgradeRunning(
	client: Client,
	deps: AgentDeps,
	o: { yes?: boolean; check?: boolean; source?: UpdateSource }
): Promise<void> {
	if (o.source) {
		const v = await client.post<UpdateView>('/api/wheelhouse/source', { source: o.source });
		if (v.job?.state !== 'running') return deps.log(`The update source is ${v.source}.`);
		deps.log(`Switching the update source to ${o.source}; Wheelhouse restarts from it.`);
		return follow(client, deps);
	}
	const v = await client.post<UpdateView>('/api/wheelhouse/update');
	if (!v.check) throw new CliError('Wheelhouse could not check for a new version');
	describe(v.check, deps.log);
	if (v.check.state === 'current') return;
	if (v.check.state !== 'available') {
		for (const ch of v.check.changes) deps.log(`  ${ch}`);
		throw new CliError(v.check.reason?.replace(/\.$/, '') ?? `the check says ${v.check.state}`);
	}
	if (o.check) return;
	if (v.busy.length) {
		deps.log(`Upgrading restarts Wheelhouse at ${client.url}, which stops what it is running:`);
		for (const b of v.busy) deps.log(`  - ${b}`);
	}
	if (!o.yes && !(await deps.confirm('Upgrade Wheelhouse now?')))
		throw new CliError('not upgraded');
	await client.post('/api/wheelhouse/upgrade');
	await follow(client, deps);
}

const source = (v: string): UpdateSource => {
	if (v !== 'published' && v !== 'github') {
		throw new InvalidArgumentError('The source is published (npm) or github (a clone).');
	}
	return v;
};

export function upgradeCommand(
	over: Partial<UpgradeCliDeps> & { env?: NodeJS.ProcessEnv; agent?: AgentDeps } = {}
): Command {
	const env = over.env ?? process.env;
	const agent = over.agent ?? { ...defaultAgentDeps(), env };
	return usageExits(
		new Command('upgrade')
			.description(
				'Upgrade Wheelhouse from its update source (the npm package, or a clone from GitHub) and restart it.'
			)
			.option('--check', 'only say whether there is a newer version')
			.option('-y, --yes', 'upgrade (and restart, even mid-work) without asking')
			.option(
				'--source <source>',
				'switch the update source of the running Wheelhouse to published (npm) or github (a clone), and restart from it',
				source
			)
			.option(
				'--url <url>',
				'the running Wheelhouse (default: $WHEELHOUSE_URL, else the one running)'
			)
			.option(
				'--plugins-dir <dir>',
				'the plugins directory the running Wheelhouse loads from, to find it (default: $WHEELHOUSE_PLUGINS_DIR, else ~/.wheelhouse/plugins)'
			)
			.option(
				'--config-dir <dir>',
				'the Wheelhouse config that keeps the update source, when none is running (default: $WHEELHOUSE_CONFIG_DIR, else $XDG_CONFIG_HOME/wheelhouse, else ~/.config/wheelhouse)'
			)
	).action(
		act(
			agent,
			async (o: {
				check?: boolean;
				yes?: boolean;
				source?: UpdateSource;
				url?: string;
				pluginsDir?: string;
				configDir?: string;
			}) => {
				const pluginsDir = o.pluginsDir ? path.resolve(o.pluginsDir) : defaultPluginsDir(env);
				const running = await findInstance({ url: o.url, pluginsDir }, agent);
				if (running) return upgradeRunning(new Client(running, agent, pluginsDir), agent, o);
				if (o.source) {
					throw new CliError(
						'Wheelhouse is not running; start it with `wheelhouse open` to switch its update source',
						EXIT.notRunning
					);
				}
				const deps: UpgradeCliDeps = {
					dir: installDir(),
					confirm: askTerminal,
					restart: (proceed) => requestRestart(pluginsDir, proceed),
					log: (line) => console.log(line),
					...over
				};
				const configDir = o.configDir ? path.resolve(o.configDir) : defaultConfigDir(env);
				const { settings } = await new UpdateSettings(updateDir(configDir)).read();
				const kind = (await detectInstallKind(deps.dir)).kind;
				const from = settings.source ?? (kind === 'clone' ? 'github' : 'published');
				const ok =
					from === 'published' && kind !== 'clone'
						? await upgradeNpmHere(deps, o)
						: await upgrade(deps, o);
				if (!ok) process.exitCode = EXIT.failed;
			}
		)
	);
}
