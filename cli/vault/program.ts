import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type { Writable } from 'node:stream';
import { Command, InvalidArgumentError } from 'commander';
import { version } from '../../package.json';
import { defaultConfigDir } from '../../src/lib/server/plugins/config';
import { appendAudit, lastUsed, readAudit, type AuditEntry, type AuditEvent } from './audit';
import type { VaultBackend } from './backend';
import { resolveCaller, type Caller } from './caller';
import { parseDotenv } from './dotenv';
import { runWithSecrets } from './run';
import {
	emptyVault,
	grantedTo,
	PROJECT_ID,
	readVault,
	SECRET_NAME,
	vaultDir,
	writeVault,
	type VaultFile
} from './store';

/**
 * `wh-vault`: secrets for Firstmate's crew by name, never by value. The
 * captain stores values (`set`, `import`) and says which projects may use each
 * (`grant`, `revoke`); a worker runs one command at a time with its project's
 * secrets in that command's environment (`run`), sees which names it may use
 * (`list`), and every use is logged by name (`audit`). Values live in the
 * backend (the macOS login Keychain); names, grants and the log in the vault
 * folder of Wheelhouse's config directory. Nothing here prints a value.
 */

export interface VaultCliDeps {
	backend: VaultBackend;
	env: NodeJS.ProcessEnv;
	cwd: string;
	stdout: Writable;
	stderr: Writable;
	/** Reads a value the captain types or pipes in; null when they gave none. */
	readValue: (prompt: string) => Promise<string | null>;
	/** Who is asking (defaults to resolveCaller over env and cwd). */
	caller?: () => Promise<Caller>;
	now?: () => Date;
	/** Pass SIGTERM and SIGHUP on to a `run` command. */
	forwardSignals?: boolean;
}

class CliError extends Error {
	constructor(
		message: string,
		readonly code = 1
	) {
		super(message);
	}
}

const secretName = (v: string) => {
	if (!SECRET_NAME.test(v)) {
		throw new InvalidArgumentError(
			'A secret name is an environment variable name: letters, digits and underscores, not starting with a digit.'
		);
	}
	return v;
};
const projectId = (v: string) => {
	if (!PROJECT_ID.test(v)) {
		throw new InvalidArgumentError(
			'A project id is the project’s name in Firstmate: letters, digits, dots, dashes and underscores.'
		);
	}
	return v;
};
const names = (v: string, prev: string[] = []) => [
	...prev,
	...v
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean)
		.map(secretName)
];
const limit = (v: string) => {
	const n = Number(v);
	if (!Number.isInteger(n) || n < 1) throw new InvalidArgumentError('A whole number above 0.');
	return n;
};

/** A date as the captain reads it: local time to the minute. */
export function when(iso: string | null | undefined): string {
	if (!iso) return 'never';
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return iso;
	const p = (n: number) => String(n).padStart(2, '0');
	return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** A path as one shell word. */
const shellQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/** Rows as aligned columns. */
function columns(rows: string[][]): string {
	const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => r[i].length)));
	return rows
		.map((r) =>
			r
				.map((c, i) => c.padEnd(widths[i]))
				.join('  ')
				.trimEnd()
		)
		.join('\n');
}

export function vaultProgram(deps: VaultCliDeps): Command {
	const now = deps.now ?? (() => new Date());
	const out = (line = '') => deps.stdout.write(`${line}\n`);
	const program = new Command('wh-vault')
		.description(
			'Secrets for Firstmate’s crew by name, never by value: values stay in the macOS login Keychain, and a project’s granted secrets reach one command at a time.'
		)
		.version(version)
		.option(
			'--config-dir <dir>',
			'the Wheelhouse config directory whose vault folder holds the vault (default: $WHEELHOUSE_CONFIG_DIR, else $XDG_CONFIG_HOME/wheelhouse, else ~/.config/wheelhouse)'
		)
		.enablePositionalOptions()
		.showHelpAfterError();
	program.configureOutput({
		writeOut: (s) => deps.stdout.write(s),
		writeErr: (s) => deps.stderr.write(s)
	});

	const dirOf = () => {
		const configDir = program.opts().configDir as string | undefined;
		return vaultDir(configDir ? path.resolve(deps.cwd, configDir) : defaultConfigDir(deps.env));
	};
	const caller = () => (deps.caller ?? (() => resolveCaller({ env: deps.env, cwd: deps.cwd })))();
	const task = () => {
		const t = deps.env.FM_TASK_ID?.trim();
		return t ? t : null;
	};
	const audit = (dir: string, e: Omit<AuditEntry, 'at' | 'task'>) =>
		appendAudit(dir, { at: now().toISOString(), task: task(), ...e });
	const loadVault = async (dir: string): Promise<VaultFile> => {
		const vault = (await readVault(dir)) ?? emptyVault(deps.backend.id);
		if (vault.backend !== deps.backend.id) {
			throw new CliError(
				`this vault keeps its values in the ${vault.backend} backend, which this wh-vault does not have`
			);
		}
		return vault;
	};
	const needSecret = (vault: VaultFile, name: string) => {
		if (!vault.secrets[name]) {
			throw new CliError(
				`there is no secret named ${name}; store it first with \`wh-vault set ${name}\``
			);
		}
	};
	const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

	/** Wraps an action: a CliError or BackendError is one line on stderr and an exit status. */
	const act =
		<A extends unknown[]>(fn: (...a: A) => Promise<number | void>) =>
		async (...a: A) => {
			try {
				const code = await fn(...a);
				process.exitCode = code ?? 0;
			} catch (e) {
				deps.stderr.write(`wh-vault: ${messageOf(e)}.\n`);
				process.exitCode = e instanceof CliError ? e.code : 1;
			}
		};

	/** Store one value and record it; returns whether it replaced one. */
	const store = async (dir: string, vault: VaultFile, name: string, value: string) => {
		if (!value) throw new CliError(`no value given for ${name}; nothing was stored`);
		await deps.backend.set(name, value);
		const at = now().toISOString();
		const had = vault.secrets[name];
		vault.secrets[name] = had
			? { ...had, updatedAt: at }
			: { projects: [], createdAt: at, updatedAt: at };
		return !!had;
	};

	program
		.command('set <name>')
		.description(
			'Store a value under NAME in the Keychain, typed without echo (or piped on stdin); replaces any value already there.'
		)
		.action(
			act(async (name: string) => {
				secretName(name);
				const dir = dirOf();
				const vault = await loadVault(dir);
				const value = await deps.readValue(`Value for ${name} (not shown): `);
				if (value === null) throw new CliError(`no value given for ${name}; nothing was stored`);
				const replaced = await store(dir, vault, name, value);
				await writeVault(dir, vault);
				await audit(dir, { event: 'set', names: [name], project: null });
				out(
					replaced ? `Replaced the value of ${name}.` : `Stored ${name} in ${deps.backend.where}.`
				);
				const projects = vault.secrets[name].projects;
				out(
					projects.length
						? `Granted to: ${projects.join(', ')}.`
						: `No project may use it yet. Grant it with: wh-vault grant ${name} <project>`
				);
			})
		);

	program
		.command('import <file>')
		.description(
			'Store every NAME=value line of a .env file in the Keychain, then show how to delete the file.'
		)
		.action(
			act(async (file: string) => {
				const full = path.resolve(deps.cwd, file);
				let text: string;
				try {
					if (!(await stat(full)).isFile()) throw new Error('not a file');
					text = await readFile(full, 'utf8');
				} catch (e) {
					throw new CliError(`cannot read ${file}: ${messageOf(e)}`);
				}
				const parsed = parseDotenv(text);
				const entries = parsed.entries.filter(({ name, line }) => {
					if (SECRET_NAME.test(name)) return true;
					deps.stderr.write(
						`wh-vault: skipped line ${line} of ${file}: a secret name is at most 128 characters.\n`
					);
					return false;
				});
				const { skipped } = parsed;
				if (skipped.length) {
					deps.stderr.write(
						`wh-vault: skipped line${skipped.length === 1 ? '' : 's'} ${skipped.join(', ')} of ${file}: not a NAME=value line.\n`
					);
				}
				if (!entries.length) throw new CliError(`${file} has no NAME=value lines to import`);
				const dir = dirOf();
				const vault = await loadVault(dir);
				const stored: string[] = [];
				const replaced: string[] = [];
				let failure: unknown = null;
				for (const { name, value } of entries) {
					if (!value) {
						deps.stderr.write(`wh-vault: ${name} is empty in ${file}; not stored.\n`);
						continue;
					}
					try {
						((await store(dir, vault, name, value)) ? replaced : stored).push(name);
					} catch (e) {
						failure = e;
						break;
					}
				}
				const done = [...stored, ...replaced];
				if (done.length) {
					await writeVault(dir, vault);
					await audit(dir, { event: 'set', names: done, project: null });
				}
				if (stored.length) out(`Stored in ${deps.backend.where}: ${stored.join(', ')}.`);
				if (replaced.length) out(`Replaced: ${replaced.join(', ')}.`);
				if (failure) throw failure;
				out(
					`Check them with \`wh-vault list --all\`, then delete the file: rm ${shellQuote(full)}`
				);
				out('Grant each to the projects that need it: wh-vault grant NAME <project>');
			})
		);

	program
		.command('list')
		.description(
			'The secret names granted to this project (a Firstmate task’s, else the origin remote’s), or with --all every secret and its grants. Never values.'
		)
		.option(
			'--all',
			'every secret, with the projects it is granted to and when it was set and used'
		)
		.option('--json', 'machine-readable output')
		.action(
			act(async (o: { all?: boolean; json?: boolean }) => {
				const dir = dirOf();
				const vault = await readVault(dir);
				if (o.all) {
					const used = await lastUsed(dir);
					const secrets = Object.entries(vault?.secrets ?? {})
						.sort(([a], [b]) => a.localeCompare(b))
						.map(([name, s]) => ({ name, ...s, lastUsedAt: used.get(name) ?? null }));
					if (o.json) {
						out(
							JSON.stringify({
								schema: 'wh-vault.list.v1',
								initialized: vault !== null,
								backend: vault?.backend ?? deps.backend.id,
								secrets
							})
						);
						return;
					}
					if (!secrets.length) {
						out('The vault is empty. Store a secret with: wh-vault set NAME');
						return;
					}
					out(
						columns([
							['NAME', 'PROJECTS', 'SET', 'LAST USED'],
							...secrets.map((s) => [
								s.name,
								s.projects.join(',') || '-',
								when(s.updatedAt),
								when(s.lastUsedAt)
							])
						])
					);
					return;
				}
				const c = await caller();
				const granted = c.project && vault ? grantedTo(vault, c.project) : [];
				if (o.json) {
					out(JSON.stringify({ schema: 'wh-vault.list.v1', ...c, names: granted }));
					return;
				}
				if (!c.project) {
					out(
						'wh-vault cannot tell which project this is: there is no Firstmate task record (FM_TASK_ID) and no origin remote here. `wh-vault list --all` shows every secret.'
					);
					return;
				}
				const from = c.via === 'task-record' ? `task ${c.task}` : 'the origin remote';
				if (!granted.length) {
					out(`No secrets are granted to ${c.project} (from ${from}).`);
					return;
				}
				out(`Secrets granted to ${c.project} (from ${from}):`);
				for (const n of granted) out(`  ${n}`);
				out('Use them in one command with: wh-vault run -- <command>');
			})
		);

	const changeGrant = (event: 'grant' | 'revoke') =>
		act(async (name: string, projects: string[]) => {
			secretName(name);
			projects.forEach(projectId);
			const dir = dirOf();
			const vault = await loadVault(dir);
			needSecret(vault, name);
			const s = vault.secrets[name];
			const set = new Set(s.projects);
			for (const p of projects) {
				if (event === 'grant') set.add(p);
				else set.delete(p);
			}
			s.projects = [...set].sort();
			await writeVault(dir, vault);
			for (const p of projects) await audit(dir, { event, names: [name], project: p });
			out(
				s.projects.length
					? `${name} is granted to: ${s.projects.join(', ')}.`
					: `${name} is granted to no project.`
			);
		});

	program
		.command('grant <name> <projects...>')
		.description('Let commands run for these projects receive NAME.')
		.action(changeGrant('grant'));
	program
		.command('revoke <name> <projects...>')
		.description('Stop commands run for these projects receiving NAME.')
		.action(changeGrant('revoke'));

	program
		.command('remove <name>')
		.description('Delete NAME’s value from the Keychain and its grants from the vault.')
		.action(
			act(async (name: string) => {
				secretName(name);
				const dir = dirOf();
				const vault = await loadVault(dir);
				needSecret(vault, name);
				await deps.backend.remove(name);
				delete vault.secrets[name];
				await writeVault(dir, vault);
				await audit(dir, { event: 'remove', names: [name], project: null });
				out(`Removed ${name}.`);
			})
		);

	program
		.command('run')
		.description(
			'Run one command with this project’s granted secrets in its environment, hiding their values in its output and logging the use by name.'
		)
		.argument('<command...>', 'the command and its arguments, after --')
		.option(
			'--only <names>',
			'hand over only these names (comma-separated, or repeat --only)',
			names
		)
		.passThroughOptions()
		.action(
			act(async (command: string[], o: { only?: string[] }) => {
				if (!command.length) throw new CliError('no command given: wh-vault run -- <command>', 2);
				return runWithSecrets(command, o.only, {
					backend: deps.backend,
					dir: dirOf(),
					caller: await caller(),
					env: deps.env,
					cwd: deps.cwd,
					stdout: deps.stdout,
					stderr: deps.stderr,
					now,
					forwardSignals: deps.forwardSignals
				});
			})
		);

	program
		.command('audit')
		.description(
			'The usage log, newest first: who used which names, when, for what and how it ended. Never values.'
		)
		.option('--project <id>', 'only this project', projectId)
		.option('--task <id>', 'only this Firstmate task')
		.option('--name <name>', 'only uses of this secret', secretName)
		.option('--event <event>', 'only run, set, remove, grant or revoke')
		.option('--limit <n>', 'at most this many (default 50)', limit)
		.option('--json', 'machine-readable output')
		.action(
			act(
				async (o: {
					project?: string;
					task?: string;
					name?: string;
					event?: string;
					limit?: number;
					json?: boolean;
				}) => {
					const events: AuditEvent[] = ['run', 'set', 'remove', 'grant', 'revoke'];
					if (o.event !== undefined && !events.includes(o.event as AuditEvent)) {
						throw new CliError(`--event takes ${events.join(', ')}`, 2);
					}
					const entries = await readAudit(dirOf(), {
						project: o.project,
						task: o.task,
						name: o.name,
						event: o.event as AuditEvent | undefined,
						limit: o.limit ?? 50
					});
					if (o.json) {
						out(JSON.stringify({ schema: 'wh-vault.audit.v1', entries }));
						return;
					}
					if (!entries.length) {
						out('Nothing logged yet.');
						return;
					}
					out(
						columns([
							['WHEN', 'EVENT', 'PROJECT', 'TASK', 'NAMES', 'PROGRAM', 'RESULT'],
							...entries.map((e) => [
								when(e.at),
								e.event,
								e.project ?? '-',
								e.task ?? '-',
								e.names.join(',') || '-',
								e.program ?? '-',
								result(e)
							])
						])
					);
				}
			)
		);

	return program;
}

/** How a logged event ended, in a few words. */
export function result(e: AuditEntry): string {
	if (e.event !== 'run') return 'done';
	if (e.outcome === 'ok') return e.signal ? `ok (${e.signal})` : `ok (exit ${e.exit ?? '?'})`;
	return e.outcome ?? '-';
}
