import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	decodeValue,
	encodeValue,
	KeychainBackend,
	securityRunner,
	type SecurityResult,
	type SecurityRunner
} from './keychain';

/**
 * The Keychain backend against a stand-in for `security`: never the real
 * Keychain, which would touch the captain's login keychain and could show a
 * dialog on their screen.
 */

interface Call {
	args: string[];
	input?: string;
}

function fake(answer: (c: Call) => Partial<SecurityResult>): {
	run: SecurityRunner;
	calls: Call[];
} {
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

describe('encodeValue', () => {
	it('keeps printable ASCII as written and encodes anything else', () => {
		expect(encodeValue('tok_123 abc')).toBe('tok_123 abc');
		for (const v of ['line1\nline2', 'pässwörd', 'tab\there', 'wh-vault:base64:looks-encoded']) {
			const stored = encodeValue(v);
			expect(stored).toMatch(/^wh-vault:base64:[A-Za-z0-9+/=]+$/);
			expect(decodeValue(stored)).toBe(v);
		}
		expect(decodeValue('deadbeef')).toBe('deadbeef');
	});
});

describe('KeychainBackend', () => {
	it('reads a value with find-generic-password -w, without its trailing newline', async () => {
		const f = fake(() => ({ stdout: 'tok_123\n' }));
		expect(await new KeychainBackend(f.run).get('API_TOKEN')).toBe('tok_123');
		expect(f.calls).toEqual([
			{ args: ['find-generic-password', '-s', 'wheelhouse-vault', '-a', 'API_TOKEN', '-w'] }
		]);
	});

	it('decodes a value it stored encoded', async () => {
		const f = fake(() => ({ stdout: `${encodeValue('a\nb')}\n` }));
		expect(await new KeychainBackend(f.run).get('PEM')).toBe('a\nb');
	});

	it('stores a value through security -i as hex, never in its arguments', async () => {
		const f = fake(() => ({}));
		await new KeychainBackend(f.run).set('API_TOKEN', 'tok_123');
		const [c] = f.calls;
		expect(c.args).toEqual(['-i']);
		expect(c.args.join(' ')).not.toContain('tok_123');
		expect(c.input).toBe(
			`add-generic-password -U -s wheelhouse-vault -a API_TOKEN -l "wheelhouse-vault API_TOKEN" -X ${Buffer.from('tok_123').toString('hex')}\n`
		);
		expect(c.input).not.toContain('tok_123');
	});

	it('refuses a value too long for one security -i line', async () => {
		const f = fake(() => ({}));
		await expect(new KeychainBackend(f.run).set('BIG', 'x'.repeat(4000))).rejects.toMatchObject({
			kind: 'too-large',
			message: expect.stringMatching(/at most about \d+ bytes/)
		});
		expect(f.calls).toEqual([]);
		await new KeychainBackend(f.run).set('FITS', 'x'.repeat(1800));
		expect(f.calls).toHaveLength(1);
	});

	it('says plainly when the Keychain will not answer outside the login session', async () => {
		const f = fake(() => ({
			code: 36,
			stderr: 'security: SecKeychainSearchCopyNext: User interaction is not allowed.\n'
		}));
		await expect(new KeychainBackend(f.run).get('API_TOKEN')).rejects.toMatchObject({
			kind: 'interaction-not-allowed',
			message: expect.stringContaining("outside the Mac's login session")
		});
	});

	it('tells a missing item, a missing tool and a timeout apart', async () => {
		const missing = fake(() => ({
			code: 44,
			stderr: 'security: … could not be found in the keychain.'
		}));
		await expect(new KeychainBackend(missing.run).get('NOPE')).rejects.toMatchObject({
			kind: 'not-found'
		});
		const noTool = fake(() => ({ code: null, spawnError: 'spawn /usr/bin/security ENOENT' }));
		await expect(new KeychainBackend(noTool.run).get('X')).rejects.toMatchObject({
			kind: 'unavailable',
			message: expect.stringContaining('macOS only')
		});
		const slow = fake(() => ({ code: null, timedOut: true }));
		await expect(new KeychainBackend(slow.run).get('X')).rejects.toMatchObject({
			kind: 'failed',
			message: expect.stringContaining('dialog')
		});
	});

	it('never repeats a failed store’s output, which may echo the value', async () => {
		const hex = Buffer.from('tok_123').toString('hex');
		const f = fake(() => ({ code: 1, stderr: `security: unknown command "${hex}"\n` }));
		const err = await new KeychainBackend(f.run).set('API_TOKEN', 'tok_123').catch((e) => e);
		expect(err.kind).toBe('failed');
		expect(err.message).not.toContain(hex);
		expect(err.message).not.toContain('tok_123');
	});

	it('removes an item, and treats one already gone as removed', async () => {
		const f = fake(() => ({ code: 44 }));
		await new KeychainBackend(f.run).remove('OLD');
		expect(f.calls[0].args).toEqual([
			'delete-generic-password',
			'-s',
			'wheelhouse-vault',
			'-a',
			'OLD'
		]);
	});

	it('refuses a name that could break the security -i line', async () => {
		const f = fake(() => ({}));
		await expect(new KeychainBackend(f.run).set('A B', 'v')).rejects.toMatchObject({
			kind: 'failed'
		});
		expect(f.calls).toEqual([]);
	});
});

describe('securityRunner', () => {
	let dir: string;
	beforeEach(() => {
		dir = mkdtempSync(path.join(tmpdir(), 'wh-vault-security-'));
	});
	afterEach(() => rmSync(dir, { recursive: true, force: true }));

	it('passes arguments and stdin, and reports the exit status', async () => {
		const bin = path.join(dir, 'security');
		const log = path.join(dir, 'log.json');
		writeFileSync(
			bin,
			`#!/usr/bin/env node
const fs = require('node:fs');
let input = '';
process.stdin.on('data', (c) => (input += c));
process.stdin.on('end', () => {
	fs.writeFileSync(${JSON.stringify(log)}, JSON.stringify({ args: process.argv.slice(2), input }));
	process.stdout.write('out\\n');
	process.exit(44);
});
`
		);
		chmodSync(bin, 0o755);
		const r = await securityRunner(bin)(['-i'], 'add-generic-password\n');
		expect(r).toMatchObject({ code: 44, stdout: 'out\n' });
		expect(JSON.parse(readFileSync(log, 'utf8'))).toEqual({
			args: ['-i'],
			input: 'add-generic-password\n'
		});
	});

	it('reports a tool that is not there', async () => {
		const r = await securityRunner(path.join(dir, 'missing'))(['help']);
		expect(r.code).toBeNull();
		expect(r.spawnError).toContain('ENOENT');
	});
});
