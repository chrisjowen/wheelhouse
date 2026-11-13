import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BackendError, type VaultBackend } from './backend';
import type { Caller } from './caller';
import { MASK } from './mask';
import { vaultProgram } from './program';
import { platformBackends, type Backends } from './select';

/**
 * Every wh-vault command, in-process, against a stand-in for the Keychain
 * and a temporary config directory. `run` starts real child processes.
 */

class MemoryBackend implements VaultBackend {
	readonly where: string;
	readonly short: string;
	problem: string | null = null;
	constructor(readonly id = 'keychain') {
		this.where = id === 'keychain' ? 'the test keychain' : `the test ${id}`;
		this.short = this.where;
	}
	async storeProblem() {
		return this.problem;
	}
	values = new Map<string, string>();
	failGet: BackendError | null = null;
	reads = 0;
	async get(name: string) {
		this.reads++;
		if (this.failGet) throw this.failGet;
		const v = this.values.get(name);
		if (v === undefined)
			throw new BackendError('not-found', `the Keychain has no value for ${name}`);
		return v;
	}
	async set(name: string, value: string) {
		if (this.problem) throw new BackendError('unavailable', this.problem);
		this.values.set(name, value);
	}
	async remove(name: string) {
		this.values.delete(name);
	}
}

const sink = () => {
	const chunks: Buffer[] = [];
	const stream = new Writable({
		write(c, _e, cb) {
			chunks.push(Buffer.from(c));
			cb();
		}
	});
	return { stream, text: () => Buffer.concat(chunks).toString() };
};

let root: string;
let config: string;
let backend: MemoryBackend;
/** What the program is given: the one backend, or a Linux-like choice of two. */
let given: VaultBackend | Backends | null;
let caller: Caller;
let typed: (string | null)[];

async function cli(...args: string[]) {
	const out = sink();
	const err = sink();
	process.exitCode = 0;
	const program = vaultProgram({
		backend: given ?? backend,
		env: { ...process.env, FM_TASK_ID: caller.task ?? '' },
		cwd: root,
		stdout: out.stream,
		stderr: err.stream,
		readValue: async () => typed.shift() ?? null,
		caller: async () => caller,
		now: () => new Date('2026-10-29T12:00:00Z')
	});
	program.exitOverride();
	await program.parseAsync(['--config-dir', config, ...args], { from: 'user' });
	const code = process.exitCode;
	process.exitCode = 0;
	return { out: out.text(), err: err.text(), code };
}

const vaultFile = () => path.join(config, 'vault', 'vault.json');
const auditFile = () => path.join(config, 'vault', 'audit.jsonl');
const auditLines = () =>
	readFileSync(auditFile(), 'utf8')
		.trim()
		.split('\n')
		.map((l) => JSON.parse(l));

beforeEach(() => {
	root = mkdtempSync(path.join(tmpdir(), 'wh-vault-cli-'));
	config = path.join(root, 'config');
	backend = new MemoryBackend();
	given = null;
	caller = { task: 'wh-1', project: 'wheelhouse', via: 'task-record' };
	typed = [];
});
afterEach(() => {
	rmSync(root, { recursive: true, force: true });
	process.exitCode = 0;
});

describe('wh-vault set, grant, revoke and remove', () => {
	it('stores a value in the backend and only its name in the vault file', async () => {
		typed.push('tok_SECRET_1');
		const r = await cli('set', 'VERCEL_TOKEN');
		expect(r).toMatchObject({ code: 0 });
		expect(r.out).toContain('Stored VERCEL_TOKEN in the test keychain.');
		expect(r.out).toContain('wh-vault grant VERCEL_TOKEN <project>');
		expect(backend.values.get('VERCEL_TOKEN')).toBe('tok_SECRET_1');
		const file = readFileSync(vaultFile(), 'utf8');
		expect(file).not.toContain('tok_SECRET_1');
		expect(JSON.parse(file)).toEqual({
			schema: 'wh-vault.v1',
			backend: 'keychain',
			secrets: {
				VERCEL_TOKEN: {
					projects: [],
					createdAt: '2026-10-29T12:00:00.000Z',
					updatedAt: '2026-10-29T12:00:00.000Z'
				}
			}
		});
		expect(statSync(path.join(config, 'vault')).mode & 0o777).toBe(0o700);
		expect(statSync(vaultFile()).mode & 0o777).toBe(0o600);
		expect(statSync(auditFile()).mode & 0o777).toBe(0o600);
	});

	it('stores nothing when no value is given, and refuses a bad name', async () => {
		expect(await cli('set', 'EMPTY')).toMatchObject({
			code: 1,
			err: expect.stringContaining('no value given')
		});
		expect(backend.values.size).toBe(0);
		expect(await cli('set', '1BAD')).toMatchObject({ code: 1 });
	});

	it('grants and revokes per project, logging each change', async () => {
		typed.push('v');
		await cli('set', 'API_KEY');
		expect((await cli('grant', 'API_KEY', 'wheelhouse', 'casebook')).out).toBe(
			'API_KEY is granted to: casebook, wheelhouse.\n'
		);
		expect((await cli('revoke', 'API_KEY', 'casebook')).out).toBe(
			'API_KEY is granted to: wheelhouse.\n'
		);
		expect(auditLines().map((e) => [e.event, e.project])).toEqual([
			['set', null],
			['grant', 'wheelhouse'],
			['grant', 'casebook'],
			['revoke', 'casebook']
		]);
		expect(await cli('grant', 'MISSING', 'wheelhouse')).toMatchObject({
			code: 1,
			err: expect.stringContaining('wh-vault set MISSING')
		});
	});

	it('removes a secret from the backend and the vault', async () => {
		typed.push('v');
		await cli('set', 'OLD');
		expect((await cli('remove', 'OLD')).out).toBe('Removed OLD.\n');
		expect(backend.values.has('OLD')).toBe(false);
		expect(JSON.parse(readFileSync(vaultFile(), 'utf8')).secrets).toEqual({});
	});
});

describe('wh-vault import', () => {
	it('stores each NAME=value, never printing a value, and says how to delete the file', async () => {
		const env = path.join(root, '.env');
		writeFileSync(
			env,
			'VERCEL_TOKEN=tok_v\nnonsense line with sbp_secret\nSUPABASE_TOKEN="sbp_s"\nBLANK=\n'
		);
		const r = await cli('import', '.env');
		expect(r.code).toBe(0);
		expect(backend.values).toEqual(
			new Map([
				['VERCEL_TOKEN', 'tok_v'],
				['SUPABASE_TOKEN', 'sbp_s']
			])
		);
		expect(r.out).toContain('Stored in the test keychain: VERCEL_TOKEN, SUPABASE_TOKEN.');
		expect(r.out).toContain(`rm '${env}'`);
		expect(r.err).toContain('skipped line 2');
		expect(r.err).toContain('BLANK is empty');
		for (const text of [
			r.out,
			r.err,
			readFileSync(vaultFile(), 'utf8'),
			readFileSync(auditFile(), 'utf8')
		]) {
			expect(text).not.toMatch(/tok_v|sbp_s/);
		}
		expect(readFileSync(env, 'utf8')).toContain('tok_v');
	});

	it('skips a name too long for the vault, by line, and keeps the vault readable', async () => {
		writeFileSync(path.join(root, '.env'), `OK=tok_ok\n${'N'.repeat(129)}=tok_long\n`);
		const r = await cli('import', '.env');
		expect(r.code).toBe(0);
		expect(r.err).toContain('skipped line 2');
		expect(r.err).not.toContain('tok_long');
		expect([...backend.values.keys()]).toEqual(['OK']);
		expect((await cli('list', '--all')).code).toBe(0);
	});
});

describe('wh-vault list', () => {
	beforeEach(async () => {
		typed.push('a', 'b');
		await cli('set', 'VERCEL_TOKEN');
		await cli('set', 'OTHER');
		await cli('grant', 'VERCEL_TOKEN', 'wheelhouse');
		await cli('grant', 'OTHER', 'casebook');
	});

	it('shows the caller only the names granted to its project', async () => {
		const r = await cli('list');
		expect(r.out).toContain('Secrets granted to wheelhouse (from task wh-1):\n  VERCEL_TOKEN\n');
		expect(r.out).not.toContain('OTHER');
		expect(JSON.parse((await cli('list', '--json')).out)).toEqual({
			schema: 'wh-vault.list.v1',
			task: 'wh-1',
			project: 'wheelhouse',
			via: 'task-record',
			names: ['VERCEL_TOKEN']
		});
		caller = { task: null, project: null, via: null };
		expect((await cli('list')).out).toContain('cannot tell which project this is');
	});

	it('shows every secret with its grants and use with --all', async () => {
		const all = JSON.parse((await cli('list', '--all', '--json')).out);
		expect(all).toMatchObject({
			schema: 'wh-vault.list.v1',
			initialized: true,
			backend: 'keychain'
		});
		expect(
			all.secrets.map((s: { name: string; projects: string[] }) => [s.name, s.projects])
		).toEqual([
			['OTHER', ['casebook']],
			['VERCEL_TOKEN', ['wheelhouse']]
		]);
		expect(all.secrets[1].lastUsedAt).toBeNull();
		expect((await cli('list', '--all')).out).toMatch(/^NAME\s+PROJECTS\s+SET\s+LAST USED\n/);
	});

	it('says the vault is not set up yet', async () => {
		rmSync(path.join(config, 'vault'), { recursive: true });
		expect(JSON.parse((await cli('list', '--all', '--json')).out)).toEqual({
			schema: 'wh-vault.list.v1',
			initialized: false,
			backend: 'keychain',
			secrets: []
		});
	});
});

describe('wh-vault run', () => {
	const printEnv = (name: string) => [
		process.execPath,
		'-e',
		`process.stdout.write('out:' + (process.env.${name} ?? 'unset') + '\\n'); process.stderr.write('err:' + (process.env.${name} ?? 'unset') + '\\n'); process.exit(3)`
	];

	beforeEach(async () => {
		typed.push('tok_SECRET_1', 'other_SECRET_2');
		await cli('set', 'VERCEL_TOKEN');
		await cli('set', 'OTHER');
		await cli('grant', 'VERCEL_TOKEN', 'wheelhouse');
		await cli('grant', 'OTHER', 'casebook');
	});

	it('hands the granted value to the command, hides it in its output and logs the use by name', async () => {
		const r = await cli('run', '--', ...printEnv('VERCEL_TOKEN'));
		expect(r).toEqual({ out: `out:${MASK}\n`, err: `err:${MASK}\n`, code: 3 });
		const last = auditLines().at(-1);
		expect(last).toEqual({
			at: '2026-10-29T12:00:00.000Z',
			event: 'run',
			task: 'wh-1',
			project: 'wheelhouse',
			program: path.basename(process.execPath),
			names: ['VERCEL_TOKEN'],
			outcome: 'ok',
			exit: 3,
			signal: null
		});
		expect(readFileSync(auditFile(), 'utf8')).not.toContain('tok_SECRET_1');
		const all = JSON.parse((await cli('list', '--all', '--json')).out);
		expect(all.secrets.find((s: { name: string }) => s.name === 'VERCEL_TOKEN').lastUsedAt).toBe(
			'2026-10-29T12:00:00.000Z'
		);
	});

	it('hands over only granted names: another project’s secret is not in the environment', async () => {
		const r = await cli('run', '--', ...printEnv('OTHER'));
		expect(r.out).toBe('out:unset\n');
	});

	it('refuses names not granted to the project, without running the command', async () => {
		const r = await cli('run', '--only', 'VERCEL_TOKEN,OTHER', '--', ...printEnv('OTHER'));
		expect(r.code).toBe(125);
		expect(r.out).toBe('');
		expect(r.err).toContain('OTHER is not granted to wheelhouse');
		expect(auditLines().at(-1)).toMatchObject({
			event: 'run',
			outcome: 'denied',
			names: ['VERCEL_TOKEN', 'OTHER']
		});
	});

	it('refuses when the project is unknown or has no grants', async () => {
		caller = { task: null, project: null, via: null };
		expect(await cli('run', '--', 'true')).toMatchObject({
			code: 125,
			err: expect.stringContaining('could not tell which project')
		});
		caller = { task: 'cb-1', project: 'docs', via: 'origin-remote' };
		expect(await cli('run', '--', 'true')).toMatchObject({
			code: 125,
			err: expect.stringContaining('wh-vault grant NAME docs')
		});
	});

	it('explains a Keychain that will not answer outside the login session, and logs it', async () => {
		backend.failGet = new BackendError(
			'interaction-not-allowed',
			'the Keychain would not answer here ("User interaction is not allowed")'
		);
		const r = await cli('run', '--', 'true');
		expect(r.code).toBe(125);
		expect(r.err).toContain('User interaction is not allowed');
		expect(r.err).toContain('login session');
		expect(auditLines().at(-1)).toMatchObject({ outcome: 'unavailable' });
	});

	it('reports a command that is not there', async () => {
		const r = await cli('run', '--', path.join(root, 'no-such-command'));
		expect(r.code).toBe(127);
		expect(auditLines().at(-1)).toMatchObject({ outcome: 'failed' });
	});

	it('passes the command’s own options through', async () => {
		const r = await cli(
			'run',
			process.execPath,
			'-e',
			'console.log(process.argv.slice(1).join(" "))',
			'--',
			'-x'
		);
		expect(r.out).toBe('-x\n');
	});
});

describe('what Wheelhouse runs', () => {
	it('never reads a value: list and audit work from the vault file and the log alone', async () => {
		typed.push('tok_SECRET_1');
		await cli('set', 'VERCEL_TOKEN');
		await cli('grant', 'VERCEL_TOKEN', 'wheelhouse');
		backend.failGet = new BackendError('failed', 'list and audit must not read values');
		for (const args of [
			['list', '--all', '--json'],
			['list', '--json'],
			['audit', '--json', '--event', 'run', '--task', 'wh-1', '--limit', '20']
		]) {
			expect(await cli(...args), args.join(' ')).toMatchObject({ code: 0, err: '' });
		}
		expect(backend.reads).toBe(0);
	});
});

describe('wh-vault audit', () => {
	it('lists uses newest first, filtered, never with a value', async () => {
		typed.push('tok_SECRET_1');
		await cli('set', 'VERCEL_TOKEN');
		await cli('grant', 'VERCEL_TOKEN', 'wheelhouse');
		await cli('run', '--', 'true');
		caller = { task: 'cb-1', project: 'casebook', via: 'task-record' };
		await cli('run', '--', 'true');

		const runs = JSON.parse((await cli('audit', '--json', '--event', 'run')).out).entries;
		expect(runs.map((e: { task: string; outcome: string }) => [e.task, e.outcome])).toEqual([
			['cb-1', 'denied'],
			['wh-1', 'ok']
		]);
		const mine = JSON.parse(
			(await cli('audit', '--json', '--task', 'wh-1', '--limit', '1')).out
		).entries;
		expect(mine).toMatchObject([{ event: 'run', task: 'wh-1' }]);
		const text = (await cli('audit')).out;
		expect(text).toMatch(/^WHEN\s+EVENT\s+PROJECT\s+TASK\s+NAMES\s+PROGRAM\s+RESULT\n/);
		expect(text).toContain('ok (exit 0)');
		expect(text).not.toContain('tok_SECRET_1');
		expect(await cli('audit', '--event', 'nope')).toMatchObject({ code: 2 });
	});
});

describe('choosing a backend', () => {
	let keyring: MemoryBackend;
	let envFile: MemoryBackend;
	beforeEach(() => {
		keyring = new MemoryBackend('secret-service');
		envFile = new MemoryBackend('env-file');
		given = {
			primary: keyring,
			ids: ['secret-service', 'env-file'],
			make: (id) => (id === 'env-file' ? envFile : keyring),
			hint: (b, _problem, held) =>
				b !== keyring
					? null
					: held
						? 'use the keyring session'
						: 'opt in with `wh-vault backend env-file`'
		};
	});

	it('says where values are kept and whether one can be stored, reading no value', async () => {
		const r = await cli('backend', '--json');
		expect(JSON.parse(r.out)).toEqual({
			schema: 'wh-vault.backend.v1',
			backend: 'secret-service',
			where: 'the test secret-service',
			canStore: true,
			reason: null,
			choices: ['secret-service', 'env-file']
		});
		expect(keyring.reads).toBe(0);
		expect((await cli('backend')).out).toBe(
			'Values are kept in the test secret-service.\nA value can be stored there now.\n'
		);
	});

	it('says plainly when nothing can be stored, and how to opt in to the env file', async () => {
		keyring.problem = 'no Secret Service keyring is running in this session';
		const r = await cli('backend', '--json');
		expect(JSON.parse(r.out)).toMatchObject({
			canStore: false,
			reason:
				'no Secret Service keyring is running in this session; opt in with `wh-vault backend env-file`'
		});
		const text = await cli('backend');
		expect(text.code).toBe(1);
		expect(text.out).toContain('A value cannot be stored here now');
		typed = ['tok_SECRET_1'];
		const set = await cli('set', 'A');
		expect(set.code).toBe(1);
		expect(set.err).toBe(
			'wh-vault: no Secret Service keyring is running in this session; opt in with `wh-vault backend env-file`.\n'
		);
		expect(existsSync(vaultFile())).toBe(false);
	});

	it('does not offer the env file once the vault holds keyring secrets', async () => {
		typed = ['tok_SECRET_1'];
		await cli('set', 'A');
		keyring.problem = 'no Secret Service keyring is running in this session';
		expect(JSON.parse((await cli('backend', '--json')).out).reason).toBe(
			'no Secret Service keyring is running in this session; use the keyring session'
		);
		typed = ['tok_SECRET_2'];
		const set = await cli('set', 'B');
		expect(set.code).toBe(1);
		expect(set.err).toBe(
			'wh-vault: no Secret Service keyring is running in this session; use the keyring session.\n'
		);
	});

	it('uses the env file only once opted in, and records the choice in the vault file', async () => {
		typed = ['tok_SECRET_1'];
		await cli('set', 'A');
		expect(keyring.values.get('A')).toBe('tok_SECRET_1');
		await cli('remove', 'A');

		const r = await cli('backend', 'env-file');
		expect(r.code).toBe(0);
		expect(r.out).toContain('Values are now kept in the test env-file.');
		expect(r.out).toContain('plaintext at rest, protected only by its permissions');
		expect(JSON.parse(readFileSync(vaultFile(), 'utf8')).backend).toBe('env-file');

		typed = ['tok_SECRET_2'];
		expect((await cli('set', 'B')).out).toContain('Stored B in the test env-file.');
		expect(envFile.values.get('B')).toBe('tok_SECRET_2');
		expect(keyring.values.has('B')).toBe(false);
		await cli('grant', 'B', 'wheelhouse');
		const run = await cli('run', '--', process.execPath, '-e', 'console.log(process.env.B)');
		expect(run.out).toBe(`${MASK}\n`);
		expect(JSON.parse((await cli('list', '--all', '--json')).out).backend).toBe('env-file');
	});

	it('will not switch backends while the vault holds secrets, or to one this computer lacks', async () => {
		typed = ['tok_SECRET_1'];
		await cli('set', 'A');
		const r = await cli('backend', 'env-file');
		expect(r.code).toBe(1);
		expect(r.err).toContain('the vault holds 1 secret in the test secret-service');
		expect(JSON.parse(readFileSync(vaultFile(), 'utf8')).backend).toBe('secret-service');
		const bad = await cli('backend', 'keychain');
		expect(bad.code).toBe(2);
		expect(bad.err).toContain('this computer has no "keychain" backend');
	});

	it('on a Mac, offers the Keychain only and words it as before', async () => {
		given = null;
		expect((await cli('backend')).out).toBe(
			'Values are kept in the test keychain.\nA value can be stored there now.\n'
		);
		expect((await cli('backend', 'env-file')).err).toContain(
			'this computer has no "env-file" backend; it has keychain'
		);
	});
});

describe('on a Mac', () => {
	it('describes the commands in the Keychain’s words, as before', () => {
		const program = vaultProgram({
			backend: platformBackends('darwin'),
			env: {},
			cwd: root,
			stdout: sink().stream,
			stderr: sink().stream,
			readValue: async () => null
		});
		const help = (name: string) =>
			program.commands.find((c) => c.name() === name)?.description() ?? '';
		expect(program.description()).toBe(
			'Secrets for Firstmate’s crew by name, never by value: values stay in the macOS login Keychain, and a project’s granted secrets reach one command at a time.'
		);
		expect(help('set')).toBe(
			'Store a value under NAME in the Keychain, typed without echo (or piped on stdin); replaces any value already there.'
		);
		expect(help('import')).toBe(
			'Store every NAME=value line of a .env file in the Keychain, then show how to delete the file.'
		);
		expect(help('remove')).toBe(
			'Delete NAME’s value from the Keychain and its grants from the vault.'
		);
	});
});
