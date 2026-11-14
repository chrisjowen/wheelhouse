import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import { version } from '../package.json';
import {
	diff,
	keep,
	replace,
	skillsCli,
	status,
	sync,
	uninstall,
	type Outcome,
	type SkillsCli
} from '../src/lib/server/material/ops';
import type { MaterialResult } from '../src/lib/server/material/sync';
import { defaultConfigDir } from '../src/lib/server/plugins/config';
import { askTerminal } from './plugin';

/**
 * `wheelhouse skills …`: the skills Wheelhouse installs for Firstmate and its
 * crew, as its manifest records them (src/lib/server/material). `status` says
 * what a sync would do; `sync` brings unchanged copies up to this version;
 * `diff`, `accept`, `keep` and `adopt` settle a copy someone edited or that
 * Wheelhouse never wrote; `uninstall` removes Wheelhouse's copies and stops it
 * putting them back.
 */

/** The package's bundled `skills/`, beside `dist/` (or beside `cli/` when run from source). */
const bundledSkills = () =>
	path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'skills');

export interface SkillsCommandDeps {
	env: NodeJS.ProcessEnv;
	skillsRoot: string;
	confirm: (question: string) => Promise<boolean>;
	log: (line: string) => void;
	error: (line: string) => void;
}

/** How `status` names what a sync would do. */
const PENDING: Record<string, string> = { installed: 'missing', updated: 'outdated' };

function printResult(r: MaterialResult, log: (line: string) => void, pending = false): void {
	for (const i of r.items)
		log(`${((pending && PENDING[i.state]) || i.state).padEnd(9)} ${i.id}  ${i.target}`);
	for (const d of r.drift) log(`drift     Firstmate no longer has \`${d.marker}\` in ${d.file}`);
	if (r.state === 'disabled') log(r.message);
}

export function skillsCommand(over: Partial<SkillsCommandDeps> = {}): Command {
	const deps: SkillsCommandDeps = {
		env: process.env,
		skillsRoot: bundledSkills(),
		confirm: askTerminal,
		log: (line) => console.log(line),
		error: (line) => console.error(line),
		...over
	};
	const cmd = new Command('skills')
		.description(
			'The agent skills Wheelhouse installs for Firstmate and its crew: what is installed, what changed, and settling local edits.'
		)
		.option(
			'--config-dir <dir>',
			'the Wheelhouse config whose agent-material/ keeps the record (default: $WHEELHOUSE_CONFIG_DIR, else $XDG_CONFIG_HOME/wheelhouse, else ~/.config/wheelhouse)'
		);
	const fail = (error: string) => {
		deps.error(`wheelhouse: ${error}.`);
		process.exitCode = 1;
	};
	const run = async (c: Command, work: (s: SkillsCli) => Promise<void>) => {
		const g = c.optsWithGlobals() as { configDir?: string };
		const s = await skillsCli({
			env: deps.env,
			configDir: g.configDir ? path.resolve(g.configDir) : defaultConfigDir(deps.env),
			skillsRoot: deps.skillsRoot,
			version
		});
		if (!s.ok) return fail(s.error);
		await work(s.value);
	};
	const report = (o: Outcome<string | string[]>) => {
		if (!o.ok) return fail(o.error);
		for (const line of ([] as string[]).concat(o.value)) deps.log(line);
	};
	const confirmed = async (yes: boolean | undefined, question: string) =>
		yes || (await deps.confirm(question));

	cmd
		.command('status')
		.description(
			'Show each item and its state (missing and outdated ones are what `sync` would install or update), and any Firstmate drift.'
		)
		.option('--json', 'print the full status as JSON (wheelhouse-skills-status.v1)')
		.action((o: { json?: boolean }, c: Command) =>
			run(c, async (s) => {
				const v = await status(s);
				if (o.json) return deps.log(JSON.stringify(v, null, 2));
				printResult(v.result, deps.log, true);
				if (v.result.state === 'attention' || v.result.state === 'error') {
					deps.log('');
					deps.log(v.result.message);
				}
			})
		);
	cmd
		.command('sync [ids...]')
		.description(
			'Install missing items and update unchanged ones to this version; naming items turns them on again.'
		)
		.action((ids: string[], _o: unknown, c: Command) =>
			run(c, async (s) => {
				const o = await sync(s, ids);
				if (!o.ok) return fail(o.error);
				printResult(o.value, deps.log);
				if (o.value.state === 'error') fail(o.value.message.replace(/\.$/, ''));
			})
		);
	cmd
		.command('diff <id>')
		.description('Compare an item with what Wheelhouse wrote there and with this version.')
		.action((id: string, _o: unknown, c: Command) =>
			run(c, async (s) => report(await diff(s, id)))
		);
	cmd
		.command('accept <id>')
		.description('Replace a locally edited item with this version (the edited copy is backed up).')
		.option('-y, --yes', 'replace without asking')
		.action((id: string, o: { yes?: boolean }, c: Command) =>
			run(c, async (s) => {
				if (!(await confirmed(o.yes, `Replace your edited ${id} with this version?`))) return;
				report(await replace(s, id, 'modified'));
			})
		);
	cmd
		.command('keep <id>')
		.description('Keep a locally edited item as it is until a later version changes it again.')
		.action((id: string, _o: unknown, c: Command) =>
			run(c, async (s) => report(await keep(s, id)))
		);
	cmd
		.command('adopt <id>')
		.description(
			'Replace a copy Wheelhouse did not install with the bundled version, and manage it from now on (the copy is backed up).'
		)
		.option('-y, --yes', 'replace without asking')
		.action((id: string, o: { yes?: boolean }, c: Command) =>
			run(c, async (s) => {
				if (!(await confirmed(o.yes, `Replace the existing ${id} with Wheelhouse's version?`)))
					return;
				report(await replace(s, id, 'foreign'));
			})
		);
	cmd
		.command('uninstall [ids...]')
		.description(
			'Remove items Wheelhouse installed (all of them, or those named) and stop installing them; edited copies are left.'
		)
		.option('-y, --yes', 'remove without asking')
		.action((ids: string[], o: { yes?: boolean }, c: Command) =>
			run(c, async (s) => {
				const what = ids.length ? ids.join(', ') : 'every skill Wheelhouse installed';
				if (!(await confirmed(o.yes, `Remove ${what}?`))) return;
				report(await uninstall(s, ids));
			})
		);
	return cmd;
}
