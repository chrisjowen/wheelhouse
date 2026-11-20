import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
	BROWSER,
	effectiveVoice,
	parseVoiceSettings,
	type VoiceSettings,
	type VoiceView
} from '$lib/voice/settings';
import { defaultConfigDir } from '../plugins/config';
import { elevenLabs } from './elevenlabs';
import { keyterms } from './keyterms';
import { registerVoiceProvider, voiceProvider, voiceProviders } from './providers';
import { VaultSecrets } from './secret';

/**
 * Settings → Voice and the speech Live mode uses. The choices live in
 * `<config>/voice.json` (who speaks, which voice, who hears); a provider's key
 * lives only in the vault and is read here, per call, through VaultSecrets.
 * When the chosen provider has no key or fails, `speak` and `hear` answer
 * null and the page carries on with the browser's own voice, quietly.
 */

export const VOICE_FILE = 'voice.json';

export interface VoiceServiceDeps {
	configDir: string;
	secrets?: Pick<VaultSecrets, 'get' | 'has' | 'forget'>;
	/** The words the captain is likely to say (project and task names). */
	keyterms?: () => Promise<string[]>;
}

registerVoiceProvider(elevenLabs());

export class VoiceService {
	private readonly secrets: Pick<VaultSecrets, 'get' | 'has' | 'forget'>;

	constructor(private readonly deps: VoiceServiceDeps) {
		this.secrets = deps.secrets ?? new VaultSecrets({ configDir: deps.configDir });
	}

	async settings(): Promise<VoiceSettings> {
		try {
			const raw = JSON.parse(await readFile(path.join(this.deps.configDir, VOICE_FILE), 'utf8'));
			return parseVoiceSettings(
				raw,
				voiceProviders().map((p) => p.id)
			);
		} catch {
			return parseVoiceSettings({}, []);
		}
	}

	async view(): Promise<VoiceView> {
		const settings = await this.settings();
		const providers = await Promise.all(
			voiceProviders().map(async (p) => ({
				id: p.id,
				label: p.label,
				about: p.about,
				secret: p.secret,
				hasKey: await this.secrets.has(p.secret),
				voices: p.voices,
				canHear: typeof p.hear === 'function'
			}))
		);
		return { settings, providers, effective: effectiveVoice(settings, providers) };
	}

	async save(raw: unknown): Promise<VoiceView> {
		const settings = parseVoiceSettings(
			raw,
			voiceProviders().map((p) => p.id)
		);
		await mkdir(this.deps.configDir, { recursive: true });
		const target = path.join(this.deps.configDir, VOICE_FILE);
		const temporary = `${target}.${randomUUID()}.tmp`;
		try {
			await writeFile(temporary, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 });
			await rename(temporary, target);
		} catch (error) {
			await unlink(temporary).catch(() => {});
			throw error;
		}
		return this.view();
	}

	/** The crew's words as audio, or null: then the page speaks them with the browser. */
	async speak(
		text: string,
		speed: number,
		signal?: AbortSignal
	): Promise<{ body: ReadableStream<Uint8Array>; type: string } | null> {
		const { effective } = await this.view();
		if (effective.speak === BROWSER) return null;
		const provider = voiceProvider(effective.speak);
		const key = provider && (await this.secrets.get(provider.secret));
		if (!provider || !key) return null;
		try {
			return await provider.speak(key, { text, voice: effective.voice, speed }, signal);
		} catch (error) {
			if ((error as { status?: number }).status === 401) this.secrets.forget(provider.secret);
			return null;
		}
	}

	/** The captain's words from a clip, or null: then the page keeps the browser's transcript. */
	async hear(
		audio: Uint8Array,
		type: string,
		from = 0,
		signal?: AbortSignal
	): Promise<string | null> {
		const { effective } = await this.view();
		if (effective.hear === BROWSER) return null;
		const provider = voiceProvider(effective.hear);
		const key = provider?.hear && (await this.secrets.get(provider.secret));
		if (!provider?.hear || !key) return null;
		try {
			const words = (await this.deps.keyterms?.().catch(() => [])) ?? [];
			return await provider.hear(key, { audio, type, keyterms: words, from }, signal);
		} catch (error) {
			if ((error as { status?: number }).status === 401) this.secrets.forget(provider.secret);
			return null;
		}
	}
}

let shared: VoiceService | null = null;
let terms: { at: number; list: string[] } | null = null;

/** The fleet's words, worked out at most every five minutes. */
async function fleetKeyterms(): Promise<string[]> {
	if (terms && Date.now() - terms.at < 5 * 60_000) return terms.list;
	const { currentFleet } = await import('../runtime');
	terms = { at: Date.now(), list: keyterms(await currentFleet()) };
	return terms.list;
}

/** The one VoiceService this server uses. */
export function voiceService(): VoiceService {
	shared ??= new VoiceService({
		configDir: defaultConfigDir(process.env),
		keyterms: fleetKeyterms
	});
	return shared;
}
