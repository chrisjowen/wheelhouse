import { randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { chmod, lstat, open, readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { BackendError, type VaultBackend } from './backend';
import { parseDotenv } from './dotenv';
import { ensureDir, SECRET_NAME } from './store';

/**
 * Values in a plaintext env file, for a Linux computer with no Secret Service
 * keyring (a server with no desktop login). The captain opts in to it with
 * `wh-vault backend env-file`; it is never chosen on its own.
 *
 * The file is `values.env` in the vault folder of Wheelhouse's config
 * directory, outside any repository: one `NAME="value"` line per secret, in
 * the double-quoted form `wh-vault import` reads. **It is plaintext at rest,
 * protected only by its permissions**: the file is 0600 and its folder 0700,
 * both set again on every write, and a file that is a link, belongs to someone
 * else or that others can read is refused rather than used. It is written
 * whole, to a new private file that then replaces it, so a reader never sees
 * half of it. Values reach it only from wh-vault's own memory, never through a
 * command line or a log.
 */

export const ENV_FILE = 'values.env';

export class EnvFileBackend implements VaultBackend {
	readonly id = 'env-file';
	readonly where: string;
	readonly short = 'the env file';
	readonly file: string;

	/** `dir` is the vault folder (store.ts vaultDir). */
	constructor(private readonly dir: string) {
		this.file = path.join(dir, ENV_FILE);
		this.where = `the plaintext env file ${this.file}`;
	}

	async get(name: string): Promise<string> {
		this.checkName(name);
		const v = (await this.read()).get(name);
		if (v === undefined)
			throw new BackendError('not-found', `the env file has no value for ${name}`);
		return v;
	}

	async set(name: string, value: string): Promise<void> {
		this.checkName(name);
		const values = await this.read();
		values.set(name, value);
		await this.write(values);
	}

	async remove(name: string): Promise<void> {
		this.checkName(name);
		const values = await this.read();
		if (!values.delete(name)) return;
		await this.write(values);
	}

	async storeProblem(): Promise<string | null> {
		try {
			await this.read();
			return null;
		} catch (e) {
			return e instanceof Error ? e.message : String(e);
		}
	}

	/** Every value in the file; none when there is no file yet. */
	private async read(): Promise<Map<string, string>> {
		let st;
		try {
			st = await lstat(this.file);
		} catch (e) {
			if ((e as NodeJS.ErrnoException).code === 'ENOENT') return new Map();
			throw this.unavailable(`cannot read ${this.file}: ${(e as Error).message}`);
		}
		if (!st.isFile()) throw this.unavailable(`${this.file} is not a plain file; it is not used`);
		if (typeof process.getuid === 'function' && st.uid !== process.getuid()) {
			throw this.unavailable(`${this.file} belongs to another user; it is not used`);
		}
		if (st.mode & 0o077) {
			throw this.unavailable(
				`${this.file} can be read by other users (mode ${(st.mode & 0o777).toString(8)}); it is not used until only you can read it: chmod 600 ${this.file}`
			);
		}
		let text: string;
		try {
			text = await readFile(this.file, 'utf8');
		} catch (e) {
			throw this.unavailable(`cannot read ${this.file}: ${(e as Error).message}`);
		}
		const parsed = parseDotenv(text);
		if (parsed.skipped.length) {
			throw new BackendError(
				'failed',
				`${this.file} has line${parsed.skipped.length === 1 ? '' : 's'} ${parsed.skipped.join(', ')} that wh-vault cannot read`
			);
		}
		return new Map(parsed.entries.map((e) => [e.name, e.value]));
	}

	/** The whole file, through a new 0600 file that replaces it. */
	private async write(values: Map<string, string>): Promise<void> {
		await ensureDir(this.dir);
		const text = [...values]
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([name, value]) => `${name}="${quote(value)}"\n`)
			.join('');
		const tmp = `${this.file}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
		const fh = await open(
			tmp,
			constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
			0o600
		);
		try {
			await fh.writeFile(text, 'utf8');
			await fh.sync();
		} catch (e) {
			await fh.close();
			await rm(tmp, { force: true });
			throw e;
		}
		await fh.close();
		await chmod(tmp, 0o600);
		await rename(tmp, this.file);
	}

	private checkName(name: string) {
		if (!SECRET_NAME.test(name))
			throw new BackendError('failed', `${JSON.stringify(name)} is not a secret name`);
	}

	private unavailable(message: string) {
		return new BackendError('unavailable', message);
	}
}

/** A value inside double quotes, as parseDotenv reads it back. */
export function quote(value: string): string {
	return value.replace(/[\\"\n\r\t]/g, (c) =>
		c === '\n' ? '\\n' : c === '\r' ? '\\r' : c === '\t' ? '\\t' : `\\${c}`
	);
}
