/**
 * Voice settings, shared by the server and the page. The crew in Live mode
 * speaks and hears through the browser unless the captain picks a provider in
 * Settings → Voice; a provider (ElevenLabs is built in; plugins may add more)
 * needs a key in the vault. With no key, or when the provider fails, voice
 * falls back quietly to the browser. Settings never hold a key.
 */

/** The browser's own speech: always there, nothing to set up. */
export const BROWSER = 'browser';

export interface VoiceSettings {
	/** Who speaks the crew's replies: `browser` or a provider id. */
	speak: string;
	/** The provider's voice id, or null for its default. */
	voice: string | null;
	/** Who turns the captain's speech into text: `browser` or a provider id. */
	hear: string;
}

export const DEFAULT_VOICE_SETTINGS: VoiceSettings = { speak: BROWSER, voice: null, hear: BROWSER };

export interface VoiceOption {
	id: string;
	name: string;
	/** A few words about it: accent, character. */
	note: string;
}

/** A provider as the Voice page shows it: never its key, only whether one is stored. */
export interface VoiceProviderInfo {
	id: string;
	label: string;
	/** The vault secret holding its key. */
	secret: string;
	/** Whether that secret is in the vault. */
	hasKey: boolean;
	voices: VoiceOption[];
	/** Whether it can also turn speech into text. */
	canHear: boolean;
	/** One line on what it is, for the page. */
	about: string;
}

export interface VoiceView {
	settings: VoiceSettings;
	providers: VoiceProviderInfo[];
	/** What is used now: a chosen provider without a key falls back to the browser. */
	effective: { speak: string; hear: string; voice: string | null };
}

/** Settings from a saved or posted object, keeping only known shapes. */
export function parseVoiceSettings(raw: unknown, known: readonly string[]): VoiceSettings {
	const r = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? raw : {};
	const pick = (v: unknown) =>
		typeof v === 'string' && (v === BROWSER || known.includes(v)) ? v : BROWSER;
	const rec = r as Record<string, unknown>;
	const voice =
		typeof rec.voice === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(rec.voice) ? rec.voice : null;
	return { speak: pick(rec.speak), voice, hear: pick(rec.hear) };
}

/** What is used now, given which providers have a key. */
export function effectiveVoice(
	settings: VoiceSettings,
	providers: Pick<VoiceProviderInfo, 'id' | 'hasKey' | 'canHear'>[]
): VoiceView['effective'] {
	const ready = (id: string) => providers.find((p) => p.id === id && p.hasKey);
	const speak = settings.speak !== BROWSER && ready(settings.speak) ? settings.speak : BROWSER;
	const hearer = settings.hear !== BROWSER ? ready(settings.hear) : undefined;
	return {
		speak,
		hear: hearer?.canHear ? settings.hear : BROWSER,
		voice: speak === BROWSER ? null : settings.voice
	};
}
