/**
 * The vault as the Vault page sees it, shared by the server and the browser:
 * names, grants and dates from `wh-vault list --all --json`, never a value.
 */

/** A secret's name: an environment variable name, as commands receive it (cli/vault/store.ts). */
export const SECRET_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
/** A project id as Wheelhouse and Firstmate's project registry name it (cli/vault/store.ts). */
export const PROJECT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export interface VaultSecret {
	name: string;
	/** The projects whose commands may receive it, sorted. */
	projects: string[];
	/** When its value was last set. */
	updatedAt: string;
	lastUsedAt: string | null;
}

/**
 * One change the captain makes on the Vault page or from the chat. `set`
 * stores a value (and may grant it to projects at once); with `replace: false`
 * it refuses a name the vault already holds, so the chat can ask first. The
 * others change grants or remove a secret. The value travels only in this
 * request and never comes back.
 */
export type VaultChange =
	| { action: 'set'; name: string; value: string; projects: string[]; replace?: boolean }
	| { action: 'grant' | 'revoke'; name: string; projects: string[] }
	| { action: 'remove'; name: string };

/** The answer to a change: what happened, in plain words, and the vault after it. */
export interface VaultChangeResult {
	message: string;
	secrets: VaultSecret[];
	/** When the vault was read after the change (ISO). */
	observedAt: string;
}

/** Whether the vault can store a value on this computer, from GET /api/vault. */
export interface VaultStatus {
	canStore: boolean;
	/** Why it cannot, in plain words, or null. */
	reason: string | null;
	/**
	 * Where a value goes, in plain words (`your Mac’s login Keychain`, `the
	 * login keyring (Secret Service)`, `the plaintext env file …`), or null
	 * when that is not known.
	 */
	where?: string | null;
}

/** Where a value goes, as the Vault page and the chat say it: `status.where`, once known. */
export function storeWhere(status: VaultStatus | null): string {
	return status?.where ?? 'the vault';
}

/** "atlas and lumen", "atlas, logline and lumen". */
export function andList(items: string[]): string {
	if (items.length <= 1) return items.join('');
	return `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}
