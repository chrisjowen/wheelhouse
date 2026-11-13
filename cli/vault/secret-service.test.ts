import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { explain, LOCKED, MAX_VALUE_BYTES, SecretServiceBackend } from './secret-service';
import { toolRunner, type ToolResult, type ToolRunner } from './tool';

/**
 * The Secret Service backend against stand-ins for `secret-tool` and `gdbus`:
 * never the captain's own keyring. The stand-in script below behaves as
 * libsecret 0.21.4's secret-tool did against gnome-keyring 46.1 when checked
 * by hand (exit codes, messages, the 8,191-byte cut and a silent exit 1 for a
 * missing item or a locked keyring); docs/vault.md says how it was checked.
 */

interface Call {
	args: string[];
	input?: string;
}

function fake(answer: (c: Call) => Partial<ToolResult>): { run: ToolRunner; calls: Call[] } {
	const calls: Call[] = [];
	return {
		calls,
		run: async (args, input) => {
			const c = { args, input };
			calls.push(c);
			return { code: 0, stdout: '', stderr: '', ...answer(c) };
		}
	};
}

const unlocked = () => fake(() => ({ stdout: '(<false>,)\n' }));
const locked = () => fake(() => ({ stdout: '(<true>,)\n' }));
const attrs = (name: string) => ['service', 'wheelhouse-vault', 'account', name];

describe('SecretServiceBackend', () => {
	it('stores a value on secret-tool’s standard input, never in its arguments', async () => {
		const tool = fake(() => ({}));
		await new SecretServiceBackend(tool.run, unlocked().run).set('API_TOKEN', 'tok_123\nline');
		expect(tool.calls).toEqual([
			{
				args: ['store', '--label', 'wheelhouse-vault API_TOKEN', ...attrs('API_TOKEN')],
				input: 'tok_123\nline'
			}
		]);
		expect(tool.calls[0].args.join(' ')).not.toContain('tok_123');
	});

	it('reads a value back exactly as stored, trailing newline included', async () => {
		const tool = fake(() => ({ stdout: 'tok_123\n' }));
		expect(await new SecretServiceBackend(tool.run, unlocked().run).get('API_TOKEN')).toBe(
			'tok_123\n'
		);
		expect(tool.calls[0].args).toEqual(['lookup', ...attrs('API_TOKEN')]);
	});

	it('refuses a value secret-tool would cut short, before it sees it', async () => {
		const tool = fake(() => ({}));
		const b = new SecretServiceBackend(tool.run, unlocked().run);
		await expect(b.set('BIG', 'x'.repeat(MAX_VALUE_BYTES + 1))).rejects.toMatchObject({
			kind: 'too-large',
			message: expect.stringContaining('8,191 bytes')
		});
		expect(tool.calls).toEqual([]);
		await b.set('FITS', 'x'.repeat(MAX_VALUE_BYTES));
		expect(tool.calls).toHaveLength(1);
	});

	it('takes away a value secret-tool says it stored cut short', async () => {
		const tool = fake((c) =>
			c.args[0] === 'store' ? { stderr: 'secret-tool: password is too long\n' } : {}
		);
		await expect(
			new SecretServiceBackend(tool.run, unlocked().run).set('A', 'v')
		).rejects.toMatchObject({ kind: 'too-large' });
		expect(tool.calls.map((c) => c.args[0])).toEqual(['store', 'clear']);
	});

	it('tells a missing value from a locked keyring when secret-tool says nothing', async () => {
		const silent = () => fake(() => ({ code: 1 }));
		await expect(
			new SecretServiceBackend(silent().run, unlocked().run).get('NOPE')
		).rejects.toMatchObject({ kind: 'not-found', message: 'the keyring has no value for NOPE' });
		await expect(
			new SecretServiceBackend(silent().run, locked().run).get('X')
		).rejects.toMatchObject({ kind: 'unavailable', message: LOCKED });
		// Without gdbus there is no telling; a missing value is the likelier.
		const noGdbus = fake(() => ({ code: null, spawnError: 'spawn gdbus ENOENT' }));
		await expect(
			new SecretServiceBackend(silent().run, noGdbus.run).get('X')
		).rejects.toMatchObject({ kind: 'not-found' });
	});

	it('removes a value; one already gone is removed, but a locked keyring is an error', async () => {
		const ok = fake(() => ({}));
		await new SecretServiceBackend(ok.run, unlocked().run).remove('OLD');
		expect(ok.calls[0].args).toEqual(['clear', ...attrs('OLD')]);
		const gone = fake(() => ({ code: 1 }));
		await new SecretServiceBackend(gone.run, unlocked().run).remove('OLD');
		await expect(
			new SecretServiceBackend(gone.run, locked().run).remove('OLD')
		).rejects.toMatchObject({ kind: 'unavailable', message: LOCKED });
	});

	it('says plainly why the Secret Service cannot be used', async () => {
		const cases: [Partial<ToolResult>, RegExp][] = [
			[
				{ code: null, spawnError: 'spawn secret-tool ENOENT' },
				/secret-tool is not installed.*libsecret-tools/
			],
			[
				{ code: 1, stderr: 'secret-tool: Cannot autolaunch D-Bus without X11 $DISPLAY\n' },
				/no D-Bus session/
			],
			[
				{
					code: 1,
					stderr:
						'secret-tool: The name org.freedesktop.secrets was not provided by any .service files\n'
				},
				/no Secret Service keyring \(such as gnome-keyring\) is running/
			],
			[
				{ code: 1, stderr: 'secret-tool: Cannot create an item in a locked collection\n' },
				/keyring is locked/
			],
			[
				{
					code: 1,
					stderr:
						'secret-tool: Object does not exist at path “/org/freedesktop/secrets/collection/login”\n'
				},
				/no default keyring/
			]
		];
		for (const [r, message] of cases) {
			const tool = fake(() => r);
			await expect(
				new SecretServiceBackend(tool.run, unlocked().run).set('A', 'v')
			).rejects.toMatchObject({ kind: 'unavailable', message: expect.stringMatching(message) });
		}
		const slow = fake(() => ({ code: null, timedOut: true }));
		await expect(new SecretServiceBackend(slow.run, unlocked().run).get('A')).rejects.toMatchObject(
			{ kind: 'failed', message: expect.stringContaining('unlock') }
		);
	});

	it('never repeats a failed store’s output that holds the value', async () => {
		const tool = fake(() => ({ code: 3, stderr: 'secret-tool: odd failure tok_123\n' }));
		const err = await new SecretServiceBackend(tool.run, unlocked().run)
			.set('A', 'tok_123')
			.catch((e) => e);
		expect(err.kind).toBe('failed');
		expect(err.message).not.toContain('tok_123');
	});

	it('refuses a name that is not a secret name before running anything', async () => {
		const tool = fake(() => ({}));
		await expect(
			new SecretServiceBackend(tool.run, unlocked().run).get('A B')
		).rejects.toMatchObject({ kind: 'failed' });
		expect(tool.calls).toEqual([]);
	});

	describe('storeProblem', () => {
		it('is null when secret-tool answers and the default keyring is unlocked', async () => {
			const tool = fake(() => ({ code: 1 }));
			const bus = unlocked();
			expect(await new SecretServiceBackend(tool.run, bus.run).storeProblem()).toBeNull();
			// It looks up a name no secret can have, and reads only the keyring's Locked property.
			expect(tool.calls[0].args).toEqual(['lookup', ...attrs('wh-vault-check')]);
			expect(bus.calls[0].args).toContain('org.freedesktop.Secret.Collection');
			expect(bus.calls[0].args.at(-1)).toBe('Locked');
		});

		it('says why not: no secret-tool, no bus, a locked or missing keyring', async () => {
			const silent = fake(() => ({ code: 1 }));
			expect(
				await new SecretServiceBackend(
					fake(() => ({ code: null, spawnError: 'spawn secret-tool ENOENT' })).run,
					unlocked().run
				).storeProblem()
			).toMatch(/secret-tool is not installed/);
			expect(
				await new SecretServiceBackend(
					fake(() => ({
						code: 1,
						stderr: 'secret-tool: Cannot autolaunch D-Bus without X11 $DISPLAY'
					})).run,
					unlocked().run
				).storeProblem()
			).toMatch(/no D-Bus session/);
			expect(await new SecretServiceBackend(silent.run, locked().run).storeProblem()).toBe(LOCKED);
			const noKeyring = fake(() => ({
				code: 1,
				stderr:
					'Error: GDBus.Error:org.freedesktop.DBus.Error.UnknownMethod: Object does not exist at path “/org/freedesktop/secrets/collection/login”'
			}));
			expect(await new SecretServiceBackend(silent.run, noKeyring.run).storeProblem()).toMatch(
				/no default keyring/
			);
		});
	});

	it('explain leaves other errors alone', () => {
		expect(explain('secret-tool: something else')).toBeNull();
	});
});

/** A stand-in for secret-tool that keeps items in a JSON file, as checked by hand. */
const FAKE_SECRET_TOOL = `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const dir = path.dirname(process.argv[1]);
const db = path.join(dir, 'items.json');
const items = fs.existsSync(db) ? JSON.parse(fs.readFileSync(db, 'utf8')) : {};
fs.appendFileSync(path.join(dir, 'argv.jsonl'), JSON.stringify(process.argv.slice(2)) + '\\n');
if (fs.existsSync(path.join(dir, 'no-bus'))) {
	process.stderr.write('secret-tool: Cannot autolaunch D-Bus without X11 $DISPLAY\\n');
	process.exit(1);
}
const [cmd, ...rest] = process.argv.slice(2);
const args = cmd === 'store' ? rest.slice(2) : rest;
const key = JSON.stringify(args);
if (cmd === 'store') {
	let buf = Buffer.alloc(0);
	process.stdin.on('data', (c) => (buf = Buffer.concat([buf, c])));
	process.stdin.on('end', () => {
		if (buf.length >= 8192) {
			process.stderr.write('secret-tool: password is too long\\n');
			buf = buf.subarray(0, 8192);
		}
		items[key] = buf.toString('utf8');
		fs.writeFileSync(db, JSON.stringify(items));
		process.exit(0);
	});
} else if (cmd === 'lookup') {
	if (!(key in items)) process.exit(1);
	process.stdout.write(items[key]);
} else if (cmd === 'clear') {
	if (!(key in items)) process.exit(1);
	delete items[key];
	fs.writeFileSync(db, JSON.stringify(items));
}
`;

describe('SecretServiceBackend through a stand-in secret-tool', () => {
	let dir: string;
	beforeEach(() => {
		dir = mkdtempSync(path.join(tmpdir(), 'wh-vault-secret-tool-'));
		writeFileSync(path.join(dir, 'secret-tool'), FAKE_SECRET_TOOL);
		chmodSync(path.join(dir, 'secret-tool'), 0o755);
	});
	afterEach(() => rmSync(dir, { recursive: true, force: true }));

	const backend = () =>
		new SecretServiceBackend(
			toolRunner(path.join(dir, 'secret-tool'), 10_000),
			toolRunner(path.join(dir, 'gdbus-is-not-here'), 10_000)
		);

	it('stores, reads back and removes values whole, with the value only on stdin', async () => {
		const b = backend();
		const value = 'multi\nline "quoted" \\ päss\t';
		await b.set('PEM_KEY', value);
		expect(await b.get('PEM_KEY')).toBe(value);
		await b.remove('PEM_KEY');
		await expect(b.get('PEM_KEY')).rejects.toMatchObject({ kind: 'not-found' });
		await b.remove('PEM_KEY');
		const argv = readFileSync(path.join(dir, 'argv.jsonl'), 'utf8');
		expect(argv).not.toContain('päss');
		expect(argv).toContain('"service","wheelhouse-vault","account","PEM_KEY"');
	});

	it('reports a missing session bus as the reason nothing can be stored', async () => {
		writeFileSync(path.join(dir, 'no-bus'), '');
		expect(await backend().storeProblem()).toMatch(/no D-Bus session/);
		await expect(backend().set('A', 'v')).rejects.toMatchObject({ kind: 'unavailable' });
	});
});
