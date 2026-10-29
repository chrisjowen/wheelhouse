import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import { defaultPluginsDir } from '../src/lib/server/plugins/installed';
import type { RestartOutcome } from '../src/lib/server/plugins/install';
import {
	checkClone,
	upgradeClone,
	type CloneDeps,
	type Run,
	type UpdateCheck
} from '../src/lib/server/upgrade/clone';
import { UPGRADE_STEPS } from '../src/lib/updates';
import { askTerminal } from './plugin';
import { requestRestart } from './running';

/**
 * `wheelhouse upgrade`: when Wheelhouse runs from a git clone, check the
 * default branch of its origin on GitHub and, when it has newer commits,
 * fast-forward to them, `npm ci`, `npm run build`, and restart a running
 * Wheelhouse (asking first when that would stop work in progress). A clone
 * with local changes, on another branch or with commits of its own is refused
 * and left exactly as it is: nothing is reset, stashed or merged.
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

export function upgradeCommand(
	over: Partial<UpgradeCliDeps> & { env?: NodeJS.ProcessEnv } = {}
): Command {
	const env = over.env ?? process.env;
	return new Command('upgrade')
		.description(
			'Fast-forward this Wheelhouse clone to the newest commit on GitHub, rebuild it and restart Wheelhouse.'
		)
		.option('--check', 'only say whether there is a newer version')
		.option('-y, --yes', 'upgrade (and restart, even mid-work) without asking')
		.option(
			'--plugins-dir <dir>',
			'the plugins directory the running Wheelhouse loads from, to find it (default: $WHEELHOUSE_PLUGINS_DIR, else ~/.wheelhouse/plugins)'
		)
		.action(async (o: { check?: boolean; yes?: boolean; pluginsDir?: string }) => {
			const pluginsDir = o.pluginsDir ? path.resolve(o.pluginsDir) : defaultPluginsDir(env);
			const ok = await upgrade(
				{
					dir: installDir(),
					confirm: askTerminal,
					restart: (proceed) => requestRestart(pluginsDir, proceed),
					log: (line) => console.log(line),
					...over
				},
				o
			);
			if (!ok) process.exitCode = 1;
		});
}
