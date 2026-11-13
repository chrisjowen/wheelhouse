import type { VaultBackend } from './backend';
import { EnvFileBackend } from './env-file';
import { KeychainBackend } from './keychain';
import { LOCKED, SecretServiceBackend } from './secret-service';

/**
 * Which backend holds the values on this computer. A Mac (and any platform
 * other than Linux, as before) has the macOS login Keychain only. Linux has
 * the Secret Service keyring, and, only when the captain opts in with
 * `wh-vault backend env-file`, a plaintext env file for a computer with no
 * keyring. The vault file records the choice (its `backend`), so every
 * `wh-vault`, Wheelhouse's included, uses the same one.
 */

export interface Backends {
	/** The backend used unless the vault file records another. */
	readonly primary: VaultBackend;
	/** Every backend this computer can use, by id, the primary first. */
	readonly ids: readonly string[];
	/** The backend with `id` for the vault folder `dir`. */
	make(id: string, dir: string): VaultBackend;
	/** What else to do when `current`, holding `held` secrets, cannot store values here because of `problem`, or null. */
	hint(current: VaultBackend, problem: string, held: number): string | null;
}

/** One backend and nothing else (a Mac's, or a test's). */
export function only(backend: VaultBackend): Backends {
	return { primary: backend, ids: [backend.id], make: () => backend, hint: () => null };
}

export const ENV_FILE_HINT =
	'to keep values in a plaintext file in the vault folder instead, protected only by its permissions, opt in with `wh-vault backend env-file` (see docs/vault.md)';

export const KEYRING_SESSION_HINT =
	"the vault's secrets are in the Secret Service keyring, so use wh-vault from a session that can reach it, such as the desktop session";

export function platformBackends(platform: NodeJS.Platform = process.platform): Backends {
	if (platform !== 'linux') return only(new KeychainBackend());
	const keyring = new SecretServiceBackend();
	return {
		primary: keyring,
		ids: [keyring.id, 'env-file'],
		make: (id, dir) => (id === 'env-file' ? new EnvFileBackend(dir) : keyring),
		// Offered when there is no keyring to use, not when there is one that is locked.
		hint: (current, problem, held) =>
			current.id !== keyring.id || problem.startsWith(LOCKED)
				? null
				: held
					? KEYRING_SESSION_HINT
					: ENV_FILE_HINT
	};
}
