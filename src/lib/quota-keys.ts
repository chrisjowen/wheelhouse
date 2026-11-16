import { SECRET_NAME } from './vault';

/**
 * Headroom's provider keys, shared by the server and Settings → Headroom.
 * Some providers quota-axi reads take an API key from one exact environment
 * variable. A captain may keep that key in the vault under another name (the
 * Voice page stores ElevenLabs as ELEVEN_LABS_KEY), so a mapping names the
 * vault secret for a provider. Only the server reads the value, and only to
 * put it in the environment of the quota-axi it runs; the mapping holds names.
 */

export interface QuotaKeyProvider {
	/** quota-axi's provider id. */
	id: string;
	label: string;
	/** The environment variable quota-axi reads the key from. */
	env: string;
}

/** quota-axi providers that read an API key from the environment. */
export const QUOTA_KEY_PROVIDERS: readonly QuotaKeyProvider[] = [
	{ id: 'elevenlabs', label: 'ElevenLabs', env: 'ELEVENLABS_API_KEY' },
	{ id: 'openrouter', label: 'OpenRouter', env: 'OPENROUTER_API_KEY' },
	{ id: 'deepseek', label: 'DeepSeek', env: 'DEEPSEEK_API_KEY' },
	{ id: 'minimax', label: 'MiniMax', env: 'MINIMAX_API_KEY' },
	{ id: 'mimo', label: 'MiMo', env: 'MIMO_API_KEY' },
	{ id: 'commandcode', label: 'Command Code', env: 'COMMANDCODE_API_KEY' },
	{ id: 'muse', label: 'Muse', env: 'META_API_KEY' },
	{ id: 'devin', label: 'Devin', env: 'WINDSURF_API_KEY' }
];

/** Provider id → the vault secret holding its key. */
export type QuotaKeyMap = Record<string, string>;

/**
 * Before anything is saved, ElevenLabs uses the secret Settings → Voice stores
 * its key under; every other provider needs a mapping chosen in Settings.
 */
export const DEFAULT_QUOTA_KEYS: QuotaKeyMap = { elevenlabs: 'ELEVEN_LABS_KEY' };

/** A mapping from a saved or posted object, keeping only known providers and valid names. */
export function parseQuotaKeys(raw: unknown): QuotaKeyMap {
	const r =
		typeof raw === 'object' && raw !== null && !Array.isArray(raw)
			? (raw as Record<string, unknown>)
			: {};
	const out: QuotaKeyMap = {};
	for (const p of QUOTA_KEY_PROVIDERS) {
		const v = r[p.id];
		if (typeof v === 'string' && SECRET_NAME.test(v)) out[p.id] = v;
	}
	return out;
}

export interface QuotaKeysView {
	providers: (QuotaKeyProvider & {
		/** The vault secret mapped to it, or null. */
		secret: string | null;
		/** Whether the vault holds that secret (its value is never read for the page). */
		inVault: boolean;
	})[];
	/** Every secret's name in the vault, to choose from. */
	vaultNames: string[];
}
