import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * The vault file: which secrets exist and which projects may use each. It
 * holds names, grants and dates, never a value; values are the backend's. It
 * lives with the usage log in the `vault` folder of Wheelhouse's config
 * directory, which only the captain can read (the folder 0700, its files 0600).
 */

export const VAULT_FILE = 'vault.json';
export const SCHEMA = 'wh-vault.v1';

/** A secret's name: an environment variable name, as commands receive it. */
export const SECRET_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
/** A project id as Wheelhouse and Firstmate's project registry name it. */
export const PROJECT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export interface SecretRecord {
	/** The projects whose commands may receive it, sorted. */
	projects: string[];
	createdAt: string;
	/** When its value was last set. */
	updatedAt: string;
}

export interface VaultFile {
	schema: typeof SCHEMA;
	/** The backend holding the values, e.g. `keychain`. */
	backend: string;
	secrets: Record<string, SecretRecord>;
}

export function vaultDir(configDir: string): string {
	return path.join(configDir, 'vault');
}

export function emptyVault(backend: string): VaultFile {
	return { schema: SCHEMA, backend, secrets: {} };
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);

export function parseVault(text: string): VaultFile {
	let v: unknown;
	try {
		v = JSON.parse(text);
	} catch (e) {
		throw new Error(`it is not JSON (${e instanceof Error ? e.message : String(e)})`);
	}
	if (!isRecord(v) || v.schema !== SCHEMA) throw new Error(`its schema is not ${SCHEMA}`);
	if (typeof v.backend !== 'string' || !v.backend) throw new Error('it names no backend');
	if (!isRecord(v.secrets)) throw new Error('it has no secrets object');
	const secrets: Record<string, SecretRecord> = {};
	for (const [name, s] of Object.entries(v.secrets)) {
		if (!SECRET_NAME.test(name)) throw new Error(`${JSON.stringify(name)} is not a secret name`);
		if (
			!isRecord(s) ||
			!Array.isArray(s.projects) ||
			!s.projects.every((p) => typeof p === 'string' && PROJECT_ID.test(p)) ||
			typeof s.createdAt !== 'string' ||
			typeof s.updatedAt !== 'string'
		) {
			throw new Error(`the entry for ${name} is malformed`);
		}
		secrets[name] = {
			projects: [...new Set(s.projects as string[])].sort(),
			createdAt: s.createdAt,
			updatedAt: s.updatedAt
		};
	}
	return { schema: SCHEMA, backend: v.backend, secrets };
}

/** The vault file, or null when there is none yet. */
export async function readVault(dir: string): Promise<VaultFile | null> {
	const file = path.join(dir, VAULT_FILE);
	let text: string;
	try {
		text = await readFile(file, 'utf8');
	} catch (e) {
		if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
		throw e;
	}
	try {
		return parseVault(text);
	} catch (e) {
		throw new Error(`${file} cannot be read: ${e instanceof Error ? e.message : String(e)}`);
	}
}

/** Make the vault folder, private to the captain. */
export async function ensureDir(dir: string): Promise<void> {
	await mkdir(dir, { recursive: true, mode: 0o700 });
	await chmod(dir, 0o700);
}

/** Write the vault file whole: a temporary file, then a rename, so a reader never sees half. */
export async function writeVault(dir: string, vault: VaultFile): Promise<void> {
	await ensureDir(dir);
	const file = path.join(dir, VAULT_FILE);
	const tmp = `${file}.${process.pid}.tmp`;
	await writeFile(tmp, `${JSON.stringify(vault, null, '\t')}\n`, { mode: 0o600 });
	await chmod(tmp, 0o600);
	await rename(tmp, file);
}

/** The names granted to a project, sorted. */
export function grantedTo(vault: VaultFile, project: string): string[] {
	return Object.entries(vault.secrets)
		.filter(([, s]) => s.projects.includes(project))
		.map(([name]) => name)
		.sort();
}
