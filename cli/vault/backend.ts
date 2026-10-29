/**
 * Where wh-vault keeps secret values. wh-vault keeps the names, grants and its
 * usage log itself (store.ts, audit.ts) and asks a backend only for values: the
 * macOS login Keychain today (keychain.ts). Another store, such as 1Password,
 * fits behind this same interface without changing the commands.
 */

export type BackendErrorKind =
	/** Nothing is stored under that name. */
	| 'not-found'
	/** The store would not answer in this session, e.g. the Keychain outside the Mac's login session. */
	| 'interaction-not-allowed'
	/** The store cannot be used on this computer at all. */
	| 'unavailable'
	/** The value is larger than the store can take safely. */
	| 'too-large'
	| 'failed';

export class BackendError extends Error {
	constructor(
		readonly kind: BackendErrorKind,
		message: string
	) {
		super(message);
		this.name = 'BackendError';
	}
}

export interface VaultBackend {
	/** A short id recorded in the vault file, e.g. `keychain`. */
	readonly id: string;
	/** Where values live, in plain words, e.g. `the macOS login Keychain`. */
	readonly where: string;
	/** The value stored under `name`; throws a BackendError. */
	get(name: string): Promise<string>;
	/** Store `value` under `name`, replacing any value already there. */
	set(name: string, value: string): Promise<void>;
	/** Delete the value stored under `name`; a missing one is not an error. */
	remove(name: string): Promise<void>;
}
