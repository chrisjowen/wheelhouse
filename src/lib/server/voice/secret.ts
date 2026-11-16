import { appendAudit } from '../../../../cli/vault/audit';
import type { VaultBackend } from '../../../../cli/vault/backend';
import { platformBackends } from '../../../../cli/vault/select';
import { readVault, vaultDir, type VaultFile } from '../../../../cli/vault/store';

/**
 * A voice provider's key, read from the vault for Wheelhouse's own use. The
 * captain stores it through the vault's hidden prompt (Settings → Voice opens
 * the Add a secret popup), so it lives where every other secret does: the
 * Keychain on a Mac, the keyring on Linux. Only this server process reads it,
 * to call the provider; it is never written to a settings file, logged or sent
 * to the browser. Each read the cache misses is logged in the vault's usage
 * log as a run by `wheelhouse voice`, the way `wh-vault run` logs a task's.
 *
 * Grants are for projects and their tasks; Wheelhouse itself, which hosts the
 * vault, reads a secret by name like the Vault page manages one by name.
 */

export interface SecretDeps {
	/** Wheelhouse's config directory, whose `vault` folder holds the vault. */
	configDir: string;
	/** The backend the vault records (default: this platform's). */
	backend?: (recorded: string, dir: string) => VaultBackend;
	readVault?: (dir: string) => Promise<VaultFile | null>;
	audit?: typeof appendAudit;
	now?: () => number;
}

/** How long a key read once is kept in memory before the vault is asked again. */
const KEEP_MS = 5 * 60_000;

export class VaultSecrets {
	private cache = new Map<string, { value: string; at: number }>();

	constructor(private readonly deps: SecretDeps) {}

	private get now() {
		return this.deps.now ?? Date.now;
	}

	/** Whether the vault holds a secret by this name (reads no value). */
	async has(name: string): Promise<boolean> {
		const vault = await (this.deps.readVault ?? readVault)(vaultDir(this.deps.configDir)).catch(
			() => null
		);
		return !!vault?.secrets[name];
	}

	/** The value stored under `name`, or null when there is none or the vault cannot be read. */
	async get(name: string): Promise<string | null> {
		const kept = this.cache.get(name);
		if (kept && this.now() - kept.at < KEEP_MS) return kept.value;
		const dir = vaultDir(this.deps.configDir);
		const vault = await (this.deps.readVault ?? readVault)(dir).catch(() => null);
		if (!vault?.secrets[name]) {
			this.cache.delete(name);
			return null;
		}
		const make = this.deps.backend ?? ((id: string, d: string) => platformBackends().make(id, d));
		let value: string | null = null;
		try {
			value = (await make(vault.backend, dir).get(name)) || null;
		} catch {
			value = null;
		}
		await (this.deps.audit ?? appendAudit)(dir, {
			at: new Date(this.now()).toISOString(),
			event: 'run',
			names: [name],
			task: null,
			project: null,
			program: 'wheelhouse voice',
			outcome: value ? 'ok' : 'unavailable'
		}).catch(() => {});
		if (value) this.cache.set(name, { value, at: this.now() });
		else this.cache.delete(name);
		return value;
	}

	/** Forget a kept value, e.g. after the provider refused it. */
	forget(name: string) {
		this.cache.delete(name);
	}
}
