import {
	chmodSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseDotenv } from './dotenv';
import { ENV_FILE, EnvFileBackend, quote } from './env-file';

/** The opt-in env-file backend, in a temporary vault folder. */

let root: string;
let dir: string;
beforeEach(() => {
	root = mkdtempSync(path.join(tmpdir(), 'wh-vault-env-file-'));
	dir = path.join(root, 'vault');
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const file = () => path.join(dir, ENV_FILE);
const mode = (p: string) => statSync(p).mode & 0o777;

describe('EnvFileBackend', () => {
	it('keeps values in a 0600 file in a 0700 folder, and reads them back whole', async () => {
		const b = new EnvFileBackend(dir);
		const odd = 'a\nb "q" \\ $HOME\t# not a comment\r';
		await b.set('DEPLOY_TOKEN', 'tok_1');
		await b.set('ODD', odd);
		expect(await b.get('DEPLOY_TOKEN')).toBe('tok_1');
		expect(await b.get('ODD')).toBe(odd);
		expect(mode(file())).toBe(0o600);
		expect(mode(dir)).toBe(0o700);
		expect(readFileSync(file(), 'utf8')).toBe(
			'DEPLOY_TOKEN="tok_1"\nODD="a\\nb \\"q\\" \\\\ $HOME\\t# not a comment\\r"\n'
		);
		// Nothing left behind from writing it.
		expect(readdirSync(dir)).toEqual([ENV_FILE]);
		expect(b.where).toBe(`the plaintext env file ${file()}`);
	});

	it('replaces and removes a value; a missing one is not an error to remove', async () => {
		const b = new EnvFileBackend(dir);
		await b.set('A', 'one');
		await b.set('A', 'two');
		await b.set('B', 'three');
		expect(await b.get('A')).toBe('two');
		await b.remove('A');
		await b.remove('A');
		await expect(b.get('A')).rejects.toMatchObject({ kind: 'not-found' });
		expect(await b.get('B')).toBe('three');
	});

	it('writes what wh-vault import reads', () => {
		for (const v of [
			'plain',
			'with "quotes"',
			'back\\slash',
			'new\nline',
			'tab\tcr\r',
			' #x ',
			''
		]) {
			const parsed = parseDotenv(`X="${quote(v)}"\n`);
			expect(parsed.entries[0].value).toBe(v);
		}
	});

	it('refuses a file other users can read, rather than use it', async () => {
		const b = new EnvFileBackend(dir);
		await b.set('A', 'one');
		chmodSync(file(), 0o644);
		await expect(b.get('A')).rejects.toMatchObject({
			kind: 'unavailable',
			message: expect.stringContaining('chmod 600')
		});
		expect(await b.storeProblem()).toMatch(/can be read by other users/);
		chmodSync(file(), 0o600);
		expect(await b.storeProblem()).toBeNull();
	});

	it('refuses a link in place of the file', async () => {
		mkdirSync(dir, { recursive: true, mode: 0o700 });
		const elsewhere = path.join(root, 'elsewhere.env');
		writeFileSync(elsewhere, 'A="x"\n', { mode: 0o600 });
		symlinkSync(elsewhere, file());
		await expect(new EnvFileBackend(dir).get('A')).rejects.toMatchObject({
			kind: 'unavailable',
			message: expect.stringContaining('not a plain file')
		});
	});

	it('says which lines it cannot read, never what they hold', async () => {
		mkdirSync(dir, { recursive: true, mode: 0o700 });
		writeFileSync(file(), 'A="ok"\nnot a line with tok_SECRET\n', { mode: 0o600 });
		const err = await new EnvFileBackend(dir).get('A').catch((e) => e);
		expect(err.message).toContain('line 2');
		expect(err.message).not.toContain('tok_SECRET');
	});

	it('can store values when there is no file yet', async () => {
		expect(await new EnvFileBackend(dir).storeProblem()).toBeNull();
	});
});
