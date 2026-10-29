import { spawn } from 'node:child_process';
import { BackendError, type VaultBackend } from './backend';
import { SECRET_NAME } from './store';

/**
 * The macOS login Keychain, through Apple's `security` tool: one generic
 * password item per secret, with the service `wheelhouse-vault` and the
 * secret's name as its account.
 *
 * What `security` does that shapes this file (checked on macOS 14):
 * - `-w <value>` would put the value on a command line any local process can
 *   read, so values go in through `security -i`, one command on stdin, as hex
 *   (`-X`), which needs no quoting. `security -i` exits with the status of the
 *   last command it ran.
 * - `security -i` reads stdin 4096 bytes at a time and runs the rest of a longer
 *   line as further commands, echoing them in its errors, so a line must fit.
 * - `find-generic-password -w` prints a value of printable ASCII as written,
 *   and anything else as bare hex, which cannot be told from a hex token. So a
 *   value with other characters is stored base64-encoded behind a marker.
 * - It exits 44 when there is no such item, and 36 ("User interaction is not
 *   allowed") when the process runs outside the Mac's login session, such as a
 *   terminal server started over SSH, and the Keychain cannot ask.
 * - It ignores a keychain path that does not exist and uses the default
 *   keychain, so this backend never names one.
 */

export const KEYCHAIN_SERVICE = 'wheelhouse-vault';
export const SECURITY = '/usr/bin/security';
/** The longest `security -i` line written: under its 4096-byte read. */
export const MAX_LINE_BYTES = 4000;
/** How long `security` may take: a Keychain dialog may be waiting on the screen. */
const TIMEOUT_MS = 120_000;
const ENCODED = 'wh-vault:base64:';
const EXIT_NOT_FOUND = 44;
const EXIT_INTERACTION_NOT_ALLOWED = 36;

export interface SecurityResult {
	/** null when it did not exit on its own (killed, or never started). */
	code: number | null;
	stdout: string;
	stderr: string;
	/** Why it never started, e.g. ENOENT. */
	spawnError?: string;
	timedOut?: boolean;
}

/** Runs `security` with arguments and optional stdin. */
export type SecurityRunner = (args: string[], input?: string) => Promise<SecurityResult>;

export function securityRunner(file = SECURITY, timeoutMs = TIMEOUT_MS): SecurityRunner {
	return (args, input) =>
		new Promise((resolve) => {
			const child = spawn(file, args, {
				stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe']
			});
			const out: Buffer[] = [];
			const err: Buffer[] = [];
			let timedOut = false;
			const timer = setTimeout(() => {
				timedOut = true;
				child.kill('SIGKILL');
			}, timeoutMs);
			child.stdout?.on('data', (c: Buffer) => out.push(c));
			child.stderr?.on('data', (c: Buffer) => err.push(c));
			child.on('error', (e) => {
				clearTimeout(timer);
				resolve({ code: null, stdout: '', stderr: '', spawnError: e.message });
			});
			child.on('close', (code) => {
				clearTimeout(timer);
				resolve({
					code,
					stdout: Buffer.concat(out).toString('utf8'),
					stderr: Buffer.concat(err).toString('utf8'),
					timedOut
				});
			});
			if (input !== undefined && child.stdin) {
				child.stdin.on('error', () => {
					// security may exit before reading stdin; its status says why.
				});
				child.stdin.end(input);
			}
		});
}

/** What is written to the Keychain for a value: as is when `security -w` prints it back as is. */
export function encodeValue(value: string): string {
	return /^[\x20-\x7e]*$/.test(value) && !value.startsWith(ENCODED)
		? value
		: ENCODED + Buffer.from(value, 'utf8').toString('base64');
}

export function decodeValue(stored: string): string {
	return stored.startsWith(ENCODED)
		? Buffer.from(stored.slice(ENCODED.length), 'base64').toString('utf8')
		: stored;
}

export class KeychainBackend implements VaultBackend {
	readonly id = 'keychain';
	readonly where = 'the macOS login Keychain';

	constructor(private readonly security: SecurityRunner = securityRunner()) {}

	async get(name: string): Promise<string> {
		this.check(name);
		const r = await this.security([
			'find-generic-password',
			'-s',
			KEYCHAIN_SERVICE,
			'-a',
			name,
			'-w'
		]);
		if (r.code !== 0) throw this.failure(r, name, 'read');
		return decodeValue(r.stdout.endsWith('\n') ? r.stdout.slice(0, -1) : r.stdout);
	}

	async set(name: string, value: string): Promise<void> {
		this.check(name);
		const hex = Buffer.from(encodeValue(value), 'utf8').toString('hex');
		const line = `add-generic-password -U -s ${KEYCHAIN_SERVICE} -a ${name} -l "${KEYCHAIN_SERVICE} ${name}" -X ${hex}\n`;
		if (Buffer.byteLength(line) > MAX_LINE_BYTES) {
			const room = Math.floor(
				(MAX_LINE_BYTES - (Buffer.byteLength(line) - hex.length)) / 2 - ENCODED.length
			);
			throw new BackendError(
				'too-large',
				`the value is too long for the Keychain through the security tool (at most about ${Math.max(room, 0)} bytes)`
			);
		}
		const r = await this.security(['-i'], line);
		// Never repeat what security printed: an error can echo part of the line, which holds the value.
		if (r.code !== 0)
			throw this.failure({ ...r, stdout: '', stderr: redact(r.stderr, hex) }, name, 'store');
	}

	async remove(name: string): Promise<void> {
		this.check(name);
		const r = await this.security(['delete-generic-password', '-s', KEYCHAIN_SERVICE, '-a', name]);
		if (r.code === 0) return;
		const e = this.failure(r, name, 'delete');
		if (e.kind !== 'not-found') throw e;
	}

	/** A secret name is safe to write unquoted into a `security -i` line. */
	private check(name: string) {
		if (!SECRET_NAME.test(name))
			throw new BackendError('failed', `${JSON.stringify(name)} is not a secret name`);
	}

	private failure(r: SecurityResult, name: string, verb: string): BackendError {
		if (r.spawnError !== undefined) {
			return new BackendError(
				'unavailable',
				`could not run ${SECURITY} (${r.spawnError}); the Keychain backend works on macOS only`
			);
		}
		if (r.timedOut) {
			return new BackendError(
				'failed',
				`the Keychain did not answer within ${TIMEOUT_MS / 1000} s; a Keychain dialog may be waiting on the Mac's screen`
			);
		}
		if (r.code === EXIT_INTERACTION_NOT_ALLOWED || /interaction is not allowed/i.test(r.stderr)) {
			return new BackendError(
				'interaction-not-allowed',
				'the Keychain would not answer here ("User interaction is not allowed"): this terminal runs outside the Mac\'s login session, so the Keychain cannot ask to be unlocked or to allow access'
			);
		}
		if (r.code === EXIT_NOT_FOUND || /could not be found/i.test(r.stderr)) {
			return new BackendError('not-found', `the Keychain has no value for ${name}`);
		}
		const said =
			r.stderr
				.trim()
				.split('\n')[0]
				?.replace(/^security:\s*/, '') ?? '';
		return new BackendError(
			'failed',
			`the Keychain could not ${verb} ${name} (security exited ${r.code ?? 'abnormally'}${said ? `: ${said}` : ''})`
		);
	}
}

/** Text with every run of hex digits long enough to be part of a value taken out. */
function redact(text: string, hex: string): string {
	let out = text.split(hex).join('[value]');
	out = out.replace(/[0-9a-fA-F]{16,}/g, '[value]');
	return out;
}
