import { spawn } from 'node:child_process';

/**
 * Where the gateway keeps a channel's bot token first: the macOS Keychain, as
 * a generic password (service `wheelhouse-gateway`, account named by
 * GatewaySettings from the channel and its config directory), through `/usr/bin/security`. The token is written through the tool's
 * interactive mode on stdin, so it never appears on a command line (`ps`
 * shows those), and it is never logged or put in the tool's environment.
 */

export interface Keychain {
	/** Where it keeps secrets, for the captain to read. */
	readonly where: string;
	/** The account's secret, or null when none is kept; throws when the Keychain cannot be used. */
	get(account: string): Promise<string | null>;
	/** Keep the account's secret, replacing any; throws when the Keychain cannot be used. */
	set(account: string, secret: string): Promise<void>;
	/** Remove the account's secret; returns whether there was one. */
	remove(account: string): Promise<boolean>;
}

export const KEYCHAIN_SERVICE = 'wheelhouse-gateway';
const SECURITY = '/usr/bin/security';
/** `security`'s exit status when the item is not there. */
const NOT_FOUND = 44;

function security(args: string[], input = ''): Promise<{ code: number; stdout: string }> {
	return new Promise((resolve, reject) => {
		const child = spawn(SECURITY, args, { stdio: ['pipe', 'pipe', 'ignore'] });
		let stdout = '';
		child.stdout.setEncoding('utf8').on('data', (d: string) => (stdout += d));
		child.on('error', reject);
		child.on('close', (code) => resolve({ code: code ?? -1, stdout }));
		child.stdin.on('error', () => {});
		child.stdin.end(input);
	});
}

export function macKeychain(service = KEYCHAIN_SERVICE): Keychain {
	const failed = (what: string, code: number) =>
		new Error(`the macOS Keychain could not ${what} (security exited ${code})`);
	return {
		where: `the macOS Keychain (${service})`,
		async get(account) {
			const r = await security(['find-generic-password', '-s', service, '-a', account, '-w']);
			if (r.code === NOT_FOUND) return null;
			if (r.code !== 0) throw failed('read it', r.code);
			return r.stdout.trim() || null;
		},
		async set(account, secret) {
			// Interactive mode splits its line on spaces and quotes: a secret with either is not kept here.
			if (!/^[A-Za-z0-9._-]+$/.test(secret))
				throw new Error('not a secret the Keychain line can hold');
			const r = await security(
				['-i'],
				`add-generic-password -U -s ${service} -a ${account} -w ${secret}\n`
			);
			if (r.code !== 0) throw failed('keep it', r.code);
		},
		async remove(account) {
			const r = await security(['delete-generic-password', '-s', service, '-a', account]);
			if (r.code === NOT_FOUND) return false;
			if (r.code !== 0) throw failed('remove it', r.code);
			return true;
		}
	};
}

/** The Keychain on macOS; elsewhere none, and the token goes to its file. */
export function defaultKeychain(): Keychain | null {
	return process.platform === 'darwin' ? macKeychain() : null;
}
