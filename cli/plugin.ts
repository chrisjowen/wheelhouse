import { createInterface } from 'node:readline/promises';
import path from 'node:path';
import { Command } from 'commander';
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

/**
 * `wheelhouse plugin …`: install plugins from GitHub repositories, pinned to
 * the commit fetched, and list, update, remove, enable or disable them. Each
 * change takes effect when Wheelhouse next starts. Install and update show the
 * plugin's manifest and ask first; `--yes` skips the question, for scripts.
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

export function pluginCommand(
	over: Partial<Omit<PluginCliDeps, 'dir'>> & { env?: NodeJS.ProcessEnv } = {}
): Command {
	const env = over.env ?? process.env;
	const cmd = new Command('plugin')
		.description('Install and manage plugins from GitHub repositories.')
		.option(
			'--plugins-dir <dir>',
			'where installed plugins live (default: $WHEELHOUSE_PLUGINS_DIR, else ~/.wheelhouse/plugins)'
		);
	const deps = (c: Command): PluginCliDeps => {
		const dir = c.optsWithGlobals().pluginsDir as string | undefined;
		return {
			dir: dir ? path.resolve(dir) : defaultPluginsDir(env),
			confirm: askTerminal,
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
		.option('-y, --yes', 'install without asking (for scripts)')
		.action((repo: string, o: { yes?: boolean }, c: Command) =>
			run(c, (d) => install(repo, d, { yes: o.yes }))
		);
	cmd
		.command('list')
		.description('List installed plugins, their versions and pinned commits.')
		.action((_o: unknown, c: Command) => run(c, list));
	cmd
		.command('update <id>')
		.description('Fetch the ref the plugin was installed from again (or --ref), and replace it.')
		.option('--ref <ref>', 'a tag, branch or commit to move to')
		.option('-y, --yes', 'update without asking (for scripts)')
		.action((id: string, o: { yes?: boolean; ref?: string }, c: Command) =>
			run(c, (d) => update(id, d, { yes: o.yes, ref: o.ref }))
		);
	cmd
		.command('remove <id>')
		.description('Delete an installed plugin.')
		.action((id: string, _o: unknown, c: Command) => run(c, (d) => remove(id, d)));
	cmd
		.command('enable <id>')
		.description('Turn an installed plugin on.')
		.action((id: string, _o: unknown, c: Command) => run(c, (d) => setEnabled(id, true, d)));
	cmd
		.command('disable <id>')
		.description('Turn an installed plugin off without removing it.')
		.action((id: string, _o: unknown, c: Command) => run(c, (d) => setEnabled(id, false, d)));
	return cmd;
}
