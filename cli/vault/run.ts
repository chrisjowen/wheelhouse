import { spawn } from 'node:child_process';
import { constants } from 'node:os';
import path from 'node:path';
import type { Writable } from 'node:stream';
import { appendAudit, checkAuditWritable, type AuditEntry } from './audit';
import { BackendError, type VaultBackend } from './backend';
import type { Caller } from './caller';
import { Masker } from './mask';
import { grantedTo, readVault } from './store';

/**
 * `wh-vault run [--only NAME…] -- <command>`: the secrets granted to the
 * caller's project go into that one command's environment and nowhere else,
 * its output comes back with every value hidden, and the use is logged by
 * name. The command's stdin is the terminal's; its output reaches it through
 * a pipe, so it does not see a terminal on stdout or stderr.
 *
 * Exit status: the command's own, 128 + the signal number when a signal ended
 * it, 125 when wh-vault refused or could not get the values, 126 when the
 * command could not be run and 127 when it was not found, as `env` does.
 */

export const EXIT_REFUSED = 125;
const EXIT_CANNOT_RUN = 126;
const EXIT_NOT_FOUND = 127;

export interface RunDeps {
	backend: VaultBackend;
	/** The vault folder. */
	dir: string;
	caller: Caller;
	env: NodeJS.ProcessEnv;
	cwd: string;
	stdout: Writable;
	stderr: Writable;
	now?: () => Date;
	/** Pass SIGTERM and SIGHUP on to the command (the CLI does; tests do not). */
	forwardSignals?: boolean;
}

export async function runWithSecrets(
	command: string[],
	only: string[] | undefined,
	deps: RunDeps
): Promise<number> {
	const now = deps.now ?? (() => new Date());
	const say = (line: string) => deps.stderr.write(`wh-vault: ${line}\n`);
	const program = command[0] ? path.basename(command[0]) : '';
	const { project, task } = deps.caller;

	const vault = await readVault(deps.dir);
	if (!vault) {
		say('the vault is empty. The captain stores a secret with `wh-vault set NAME`.');
		return EXIT_REFUSED;
	}
	const log = async (e: Omit<AuditEntry, 'at' | 'event' | 'task' | 'project' | 'program'>) => {
		try {
			await appendAudit(deps.dir, {
				at: now().toISOString(),
				event: 'run',
				task,
				project,
				program,
				...e
			});
		} catch (err) {
			say(`could not write the usage log: ${err instanceof Error ? err.message : String(err)}`);
		}
	};
	const refuse = async (names: string[], reason: string) => {
		say(`${reason}.`);
		await log({ names, outcome: 'denied', reason });
		return EXIT_REFUSED;
	};

	if (!project) {
		return refuse(
			only ?? [],
			'could not tell which project this is: there is no Firstmate task record (FM_TASK_ID) and no origin remote here'
		);
	}
	const granted = grantedTo(vault, project);
	let names: string[];
	if (only?.length) {
		const missing = only.filter((n) => !granted.includes(n));
		if (missing.length) {
			return refuse(
				only,
				`${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} not granted to ${project}; the captain grants one with \`wh-vault grant NAME ${project}\``
			);
		}
		names = [...new Set(only)];
	} else {
		if (!granted.length) {
			return refuse(
				[],
				`no secrets are granted to ${project}; the captain grants one with \`wh-vault grant NAME ${project}\``
			);
		}
		names = granted;
	}

	try {
		await checkAuditWritable(deps.dir);
	} catch (err) {
		say(
			`will not hand out secrets without logging the use, and the usage log cannot be written: ${err instanceof Error ? err.message : String(err)}.`
		);
		return EXIT_REFUSED;
	}

	const values: Record<string, string> = {};
	for (const name of names) {
		try {
			values[name] = await deps.backend.get(name);
		} catch (err) {
			const reason =
				err instanceof BackendError ? err.message : `could not read ${name}: ${String(err)}`;
			say(`${reason}.`);
			if (err instanceof BackendError && err.kind === 'interaction-not-allowed') {
				say(
					'Run the command from a terminal in the login session (Terminal.app, or a terminal server started there). See docs/vault.md.'
				);
			}
			await log({ names, outcome: 'unavailable', reason });
			return EXIT_REFUSED;
		}
	}

	const result = await spawnMasked(command, values, deps);
	if ('error' in result) {
		say(result.error);
		await log({ names, outcome: 'failed', reason: result.error });
		return result.code;
	}
	await log({ names, outcome: 'ok', exit: result.code, signal: result.signal });
	if (result.signal) {
		return 128 + ((constants.signals as Record<string, number>)[result.signal] ?? 0);
	}
	return result.code ?? EXIT_REFUSED;
}

type Spawned =
	{ code: number | null; signal: NodeJS.Signals | null } | { error: string; code: number };

function spawnMasked(
	command: string[],
	values: Record<string, string>,
	deps: RunDeps
): Promise<Spawned> {
	return new Promise((resolve) => {
		const child = spawn(command[0], command.slice(1), {
			cwd: deps.cwd,
			env: { ...deps.env, ...values },
			stdio: ['inherit', 'pipe', 'pipe']
		});
		const secrets = Object.values(values);
		const out = new Masker(secrets);
		const err = new Masker(secrets);
		child.stdout?.on('data', (c: Buffer) => deps.stdout.write(out.write(c)));
		child.stderr?.on('data', (c: Buffer) => deps.stderr.write(err.write(c)));

		// Ctrl-C reaches the command through the terminal's process group; these come to us alone.
		const forward = (sig: NodeJS.Signals) => () => child.kill(sig);
		const handlers = deps.forwardSignals
			? (['SIGTERM', 'SIGHUP'] as const).map((s) => [s, forward(s)] as const)
			: [];
		const onInt = () => {};
		if (deps.forwardSignals) process.on('SIGINT', onInt);
		for (const [s, h] of handlers) process.on(s, h);
		let settled = false;
		const done = (r: Spawned) => {
			if (settled) return;
			settled = true;
			if (deps.forwardSignals) process.off('SIGINT', onInt);
			for (const [s, h] of handlers) process.off(s, h);
			resolve(r);
		};

		child.on('error', (e: NodeJS.ErrnoException) =>
			done(
				e.code === 'ENOENT'
					? { error: `${command[0]}: command not found.`, code: EXIT_NOT_FOUND }
					: { error: `${command[0]}: ${e.message}.`, code: EXIT_CANNOT_RUN }
			)
		);
		child.on('close', (code, signal) => {
			if (settled) return;
			deps.stdout.write(out.end());
			deps.stderr.write(err.end());
			done({ code, signal });
		});
	});
}
