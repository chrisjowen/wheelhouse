import { createInterface } from 'node:readline/promises';
import path from 'node:path';
import { Command } from 'commander';
import { defaultConfigDir } from '../src/lib/server/plugins/config';
import { defaultPluginsDir } from '../src/lib/server/plugins/installed';
import {
	install,
	list,
	remove,
	setEnabled,
	update,
	type Outcome,
	type PluginCliDeps
} from '../src/lib/server/plugins/install';
import { requestRestart } from './running';

/**
 * `wheelhouse plugin …`: install plugins from GitHub repositories, pinned to
 * the commit fetched, and list, update, remove, enable or disable them.
 * Install and update show the plugin's manifest and ask first, then ask for
 * the settings it declares; `--yes` skips the questions, for scripts, and
 * `--setting key=value` answers one up front. Each change restarts a running
 * Wheelhouse that loads from the same plugins directory, so it loads at once;
 * one with work in progress says what a restart would stop and asks first
 * (`--yes` restarts it anyway).
 */

/** Ask on the terminal; without one, refuse rather than install unseen. */
async function askTerminal(question: string): Promise<boolean> {
	if (!process.stdin.isTTY) {
		console.error('wheelhouse: no terminal to ask on; pass --yes to agree without asking.');
		return false;
	}
	const rl = createInterface({ input: process.stdin, output: process.stdout });
	try {
		return /^y(es)?$/i.test((await rl.question(`${question} [y/N] `)).trim());
	} finally {
		rl.close();
	}
}

/** Ask for one line on the terminal; null without one, or when it closes. */
async function askLine(question: string): Promise<string | null> {
	if (!process.stdin.isTTY) return null;
	const rl = createInterface({ input: process.stdin, output: process.stdout });
	try {
		return await new Promise<string | null>((resolve) => {
			rl.once('close', () => resolve(null));
			// Ctrl+C at the question stops the command, as it would anywhere else.
			rl.once('SIGINT', () => rl.close());
			rl.question(question).then(resolve, () => resolve(null));
		});
	} finally {
		rl.close();
	}
}

const collect = (v: string, all: string[] = []) => [...all, v];

export function pluginCommand(
	over: Partial<Omit<PluginCliDeps, 'dir' | 'configDir'>> & { env?: NodeJS.ProcessEnv } = {}
): Command {
	const env = over.env ?? process.env;
	const cmd = new Command('plugin')
		.description('Install and manage plugins from GitHub repositories.')
		.option(
			'--plugins-dir <dir>',
			'where installed plugins live (default: $WHEELHOUSE_PLUGINS_DIR, else ~/.wheelhouse/plugins)'
		)
		.option(
			'--config-dir <dir>',
			'the Wheelhouse config whose plugins.json keeps plugin settings (default: $WHEELHOUSE_CONFIG_DIR, else $XDG_CONFIG_HOME/wheelhouse, else ~/.config/wheelhouse)'
		);
	const deps = (c: Command): PluginCliDeps => {
		const g = c.optsWithGlobals() as { pluginsDir?: string; configDir?: string };
		const dir = g.pluginsDir ? path.resolve(g.pluginsDir) : defaultPluginsDir(env);
		return {
			dir,
			configDir: g.configDir ? path.resolve(g.configDir) : defaultConfigDir(env),
			confirm: askTerminal,
			ask: askLine,
			restart: (proceed) => requestRestart(dir, proceed),
			log: (line) => console.log(line),
			...over
		};
	};
	const run = async (c: Command, work: (d: PluginCliDeps) => Promise<Outcome>) => {
		const o = await work(deps(c));
		if (!o.ok) {
			(over.log ?? console.error)(`wheelhouse: ${o.error}.`);
			process.exitCode = 1;
		}
	};

	cmd
		.command('install <repo>')
		.description('Install a plugin from org/repo, or org/repo@<tag, branch or commit>.')
		.option('-y, --yes', 'install without asking; settings take their defaults (for scripts)')
		.option('-s, --setting <key=value>', 'answer one of its settings (repeatable)', collect)
		.action((repo: string, o: { yes?: boolean; setting?: string[] }, c: Command) =>
			run(c, (d) => install(repo, d, { yes: o.yes, settings: o.setting }))
		);
	cmd
		.command('list')
		.description('List installed plugins, their versions and pinned commits.')
		.action((_o: unknown, c: Command) => run(c, list));
	cmd
		.command('update <id>')
		.description('Fetch the ref the plugin was installed from again (or --ref), and replace it.')
		.option('--ref <ref>', 'a tag, branch or commit to move to')
		.option('-y, --yes', 'update without asking; new settings take their defaults (for scripts)')
		.option('-s, --setting <key=value>', 'answer one of its settings (repeatable)', collect)
		.action((id: string, o: { yes?: boolean; ref?: string; setting?: string[] }, c: Command) =>
			run(c, (d) => update(id, d, { yes: o.yes, ref: o.ref, settings: o.setting }))
		);
	cmd
		.command('remove <id>')
		.description('Delete an installed plugin.')
		.option('-y, --yes', 'restart a running Wheelhouse without asking, even mid-work')
		.action((id: string, o: { yes?: boolean }, c: Command) =>
			run(c, (d) => remove(id, d, { yes: o.yes }))
		);
	cmd
		.command('enable <id>')
		.description('Turn an installed plugin on.')
		.option('-y, --yes', 'restart a running Wheelhouse without asking, even mid-work')
		.action((id: string, o: { yes?: boolean }, c: Command) =>
			run(c, (d) => setEnabled(id, true, d, { yes: o.yes }))
		);
	cmd
		.command('disable <id>')
		.description('Turn an installed plugin off without removing it.')
		.option('-y, --yes', 'restart a running Wheelhouse without asking, even mid-work')
		.action((id: string, o: { yes?: boolean }, c: Command) =>
			run(c, (d) => setEnabled(id, false, d, { yes: o.yes }))
		);
	return cmd;
}
