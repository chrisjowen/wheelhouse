import { BackendError, type VaultBackend } from './backend';
import { SECRET_NAME } from './store';
import { toolRunner, type ToolResult, type ToolRunner } from './tool';

/**
 * The Secret Service on Linux: the login keyring that a desktop session runs
 * (gnome-keyring, KWallet, KeePassXC), through libsecret's `secret-tool`. One
 * item per secret, with the attributes `service wheelhouse-vault` and
 * `account <name>`, as the Keychain backend names its items, and the label
 * `wheelhouse-vault <name>`.
 *
 * What `secret-tool` does that shapes this file (checked with libsecret 0.21.4
 * and gnome-keyring 46.1):
 * - `store` reads the value from stdin when stdin is not a terminal and stores
 *   it as given, line breaks included; `lookup` prints it back as stored, with
 *   no newline added when stdout is not a terminal. Values never go on a
 *   command line.
 * - `store` reads at most 8,191 bytes: from 8,192 on it prints "password is too
 *   long" yet exits 0 having stored the value cut short, so a longer value is
 *   refused here before secret-tool sees it.
 * - `lookup` and `clear` exit 1 and print nothing both when there is no such
 *   item and when the keyring holding it is locked, so a silent exit 1 is
 *   checked against whether the default keyring is locked (`gdbus`, below).
 * - With no D-Bus session (a server with no desktop login), no keyring daemon,
 *   no default keyring or a locked one, `store` exits 1 and says which.
 *
 * Whether the default keyring exists and is locked is read with glib's
 * `gdbus`, as the `Locked` property of the Secret Service's default
 * collection; that reads no value. Without gdbus, those checks are skipped and
 * secret-tool's own errors say what went wrong.
 */

export const SECRET_SERVICE_ATTRIBUTE = 'wheelhouse-vault';
export const SECRET_TOOL = 'secret-tool';
export const GDBUS = 'gdbus';
/** The longest value secret-tool stores whole. */
export const MAX_VALUE_BYTES = 8191;
/** How long secret-tool may take: an unlock prompt may be waiting on the screen. */
const TIMEOUT_MS = 120_000;
/** How long the gdbus check may take. */
const CHECK_TIMEOUT_MS = 10_000;
/** A name no secret can have (it has a dash), looked up to see whether the keyring answers. */
const PROBE_NAME = 'wh-vault-check';

/** What the Secret Service says about its default keyring. */
type KeyringState = 'unlocked' | 'locked' | 'unknown' | { problem: string };

export class SecretServiceBackend implements VaultBackend {
	readonly id = 'secret-service';
	readonly where = 'the login keyring (Secret Service)';
	readonly short = 'the keyring';

	constructor(
		private readonly secretTool: ToolRunner = toolRunner(SECRET_TOOL, TIMEOUT_MS),
		private readonly gdbus: ToolRunner = toolRunner(GDBUS, CHECK_TIMEOUT_MS)
	) {}

	async get(name: string): Promise<string> {
		this.checkName(name);
		const r = await this.secretTool(['lookup', ...attributes(name)]);
		if (r.code === 0) return r.stdout;
		if (silent(r)) {
			const locked = await this.lockedProblem();
			if (locked) throw new BackendError('unavailable', locked);
			throw new BackendError('not-found', `the keyring has no value for ${name}`);
		}
		throw this.failure(r, name, 'read');
	}

	async set(name: string, value: string): Promise<void> {
		this.checkName(name);
		if (Buffer.byteLength(value) > MAX_VALUE_BYTES) {
			throw new BackendError(
				'too-large',
				`the value is too long for the keyring through secret-tool (at most ${MAX_VALUE_BYTES.toLocaleString('en-US')} bytes)`
			);
		}
		const r = await this.secretTool(
			['store', '--label', `${SECRET_SERVICE_ATTRIBUTE} ${name}`, ...attributes(name)],
			value
		);
		// Never repeat what secret-tool printed if it holds the value.
		if (r.code !== 0) throw this.failure(r, name, 'store', value);
		if (/too long/i.test(r.stderr)) {
			// secret-tool stored it cut short; take that away rather than leave a wrong value.
			await this.secretTool(['clear', ...attributes(name)]);
			throw new BackendError('too-large', `secret-tool would not take the whole value of ${name}`);
		}
	}

	async remove(name: string): Promise<void> {
		this.checkName(name);
		const r = await this.secretTool(['clear', ...attributes(name)]);
		if (r.code === 0) return;
		if (silent(r)) {
			// Nothing was cleared: there was no such item, or the keyring is locked.
			const locked = await this.lockedProblem();
			if (locked) throw new BackendError('unavailable', locked);
			return;
		}
		throw this.failure(r, name, 'delete');
	}

	async storeProblem(): Promise<string | null> {
		const r = await this.secretTool(['lookup', ...attributes(PROBE_NAME)]);
		if (r.code !== 0 && !silent(r)) return this.failure(r, '', 'answer').message;
		const state = await this.keyring();
		if (typeof state === 'object') return state.problem;
		if (state === 'locked') return LOCKED;
		return null;
	}

	/** Why the keyring cannot answer, if it is locked or missing; else null. */
	private async lockedProblem(): Promise<string | null> {
		const state = await this.keyring();
		if (state === 'locked') return LOCKED;
		return typeof state === 'object' ? state.problem : null;
	}

	/** The default keyring's state, from its `Locked` property; reads no value. */
	private async keyring(): Promise<KeyringState> {
		const r = await this.gdbus([
			'call',
			'--session',
			'--dest',
			'org.freedesktop.secrets',
			'--object-path',
			'/org/freedesktop/secrets/aliases/default',
			'--method',
			'org.freedesktop.DBus.Properties.Get',
			'org.freedesktop.Secret.Collection',
			'Locked'
		]);
		if (r.spawnError !== undefined || r.timedOut) return 'unknown';
		if (r.code === 0) {
			if (/<?\btrue\b>?/.test(r.stdout)) return 'locked';
			if (/<?\bfalse\b>?/.test(r.stdout)) return 'unlocked';
			return 'unknown';
		}
		const problem = explain(r.stderr);
		return problem ? { problem } : 'unknown';
	}

	/** A secret name is all an attribute value here ever is. */
	private checkName(name: string) {
		if (!SECRET_NAME.test(name))
			throw new BackendError('failed', `${JSON.stringify(name)} is not a secret name`);
	}

	private failure(r: ToolResult, name: string, verb: string, value?: string): BackendError {
		if (r.spawnError !== undefined) {
			const missing = /ENOENT/.test(r.spawnError);
			return new BackendError(
				'unavailable',
				`${missing ? `${SECRET_TOOL} is not installed` : `could not run ${SECRET_TOOL} (${r.spawnError})`}; the vault reaches the Secret Service on Linux through it, from libsecret's tools (the libsecret-tools package on Debian and Ubuntu, libsecret on Fedora and Arch)`
			);
		}
		if (r.timedOut) {
			return new BackendError(
				'failed',
				`the keyring did not answer within ${TIMEOUT_MS / 1000} s; a prompt to unlock it may be waiting on the screen`
			);
		}
		const problem = explain(r.stderr);
		if (problem) return new BackendError('unavailable', problem);
		const line =
			r.stderr
				.trim()
				.split('\n')[0]
				?.replace(/^secret-tool:\s*/, '') ?? '';
		const said = value && line.includes(value) ? '' : line;
		return new BackendError(
			'failed',
			`the keyring could not ${name ? `${verb} ${name}` : verb} (secret-tool exited ${r.code ?? 'abnormally'}${said ? `: ${said}` : ''})`
		);
	}
}

export const LOCKED =
	'the login keyring is locked, and the Secret Service would not unlock it here; unlock it (log in to the desktop, or unlock it in a keyring manager) and try again';

/** The attributes that name one Wheelhouse item. */
function attributes(name: string): string[] {
	return ['service', SECRET_SERVICE_ATTRIBUTE, 'account', name];
}

/** secret-tool's exit 1 with nothing said: no such item, or a locked keyring. */
function silent(r: ToolResult): boolean {
	return r.code === 1 && !r.stderr.trim() && !r.timedOut && r.spawnError === undefined;
}

/** What secret-tool or gdbus said, as why the Secret Service cannot be used; null when it is something else. */
export function explain(stderr: string): string | null {
	if (
		/autolaunch D-Bus|DBUS_SESSION_BUS_ADDRESS|Error connecting|Could not connect|Failed to connect|Unable to autolaunch/i.test(
			stderr
		)
	) {
		return 'there is no D-Bus session here for the Secret Service to answer on (DBUS_SESSION_BUS_ADDRESS is not set and there is no desktop login), as on a server with no keyring';
	}
	if (
		/org\.freedesktop\.secrets was not provided|ServiceUnknown|name is not activatable/i.test(
			stderr
		)
	) {
		return 'no Secret Service keyring (such as gnome-keyring) is running in this session';
	}
	if (/locked collection|is locked/i.test(stderr)) return LOCKED;
	if (/Object does not exist at path|No such object|UnknownObject/i.test(stderr)) {
		return 'the Secret Service has no default keyring to store values in';
	}
	return null;
}
