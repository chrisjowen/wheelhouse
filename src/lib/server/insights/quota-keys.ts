import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
	DEFAULT_QUOTA_KEYS,
	parseQuotaKeys,
	QUOTA_KEY_PROVIDERS,
	type QuotaKeyMap,
	type QuotaKeysView
} from '$lib/quota-keys';
import { defaultConfigDir } from '../plugins/config';
import { VaultSecrets } from '../voice/secret';

/**
 * Settings → Headroom: which vault secret holds each provider's key for
 * quota-axi. The mapping (names only) lives in `<config>/quota-keys.json`;
 * until it is saved, DEFAULT_QUOTA_KEYS applies. `env()` reads the mapped
 * values through the vault, each read logged as a run by `wheelhouse
 * headroom`, for the environment of the one quota-axi Headroom runs. A value
 * is never written to a file, logged or sent to the browser.
 */

export const QUOTA_KEYS_FILE = 'quota-keys.json';

export interface QuotaKeysDeps {
	configDir: string;
	secrets?: Pick<VaultSecrets, 'get' | 'names'>;
}

export class QuotaKeys {
	private readonly secrets: Pick<VaultSecrets, 'get' | 'names'>;

	constructor(private readonly deps: QuotaKeysDeps) {
		this.secrets =
			deps.secrets ??
			new VaultSecrets({ configDir: deps.configDir, program: 'wheelhouse headroom' });
	}

	private get file() {
		return path.join(this.deps.configDir, QUOTA_KEYS_FILE);
	}

	async mapping(): Promise<QuotaKeyMap> {
		let text: string;
		try {
			text = await readFile(this.file, 'utf8');
		} catch {
			return { ...DEFAULT_QUOTA_KEYS };
		}
		try {
			return parseQuotaKeys(JSON.parse(text));
		} catch {
			return {};
		}
	}

	async view(): Promise<QuotaKeysView> {
		const [mapping, vaultNames] = await Promise.all([
			this.mapping(),
			this.secrets.names().catch((): string[] => [])
		]);
		return {
			providers: QUOTA_KEY_PROVIDERS.map((p) => ({
				...p,
				secret: mapping[p.id] ?? null,
				inVault: !!mapping[p.id] && vaultNames.includes(mapping[p.id])
			})),
			vaultNames
		};
	}

	async save(raw: unknown): Promise<QuotaKeysView> {
		const mapping = parseQuotaKeys(raw);
		await mkdir(this.deps.configDir, { recursive: true });
		const temporary = `${this.file}.${randomUUID()}.tmp`;
		try {
			await writeFile(temporary, `${JSON.stringify(mapping, null, 2)}\n`, { mode: 0o600 });
			await rename(temporary, this.file);
		} catch (error) {
			await unlink(temporary).catch(() => {});
			throw error;
		}
		return this.view();
	}

	/**
	 * The environment quota-axi needs for the mapped providers: each provider's
	 * variable set to its vault secret's value. A secret the vault does not
	 * hold, or cannot give, is left out.
	 */
	async env(): Promise<Record<string, string>> {
		const mapping = await this.mapping();
		const out: Record<string, string> = {};
		for (const p of QUOTA_KEY_PROVIDERS) {
			const name = mapping[p.id];
			if (!name) continue;
			const value = await this.secrets.get(name).catch(() => null);
			if (value) out[p.env] = value;
		}
		return out;
	}
}

let shared: QuotaKeys | null = null;

/** The one QuotaKeys this server uses. */
export function quotaKeys(): QuotaKeys {
	shared ??= new QuotaKeys({ configDir: defaultConfigDir(process.env) });
	return shared;
}
