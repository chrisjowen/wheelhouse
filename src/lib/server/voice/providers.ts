import type { VoiceOption } from '$lib/voice/settings';

/**
 * The seam voice providers plug into. A provider turns text into speech and,
 * optionally, speech into text, using a key it reads from the vault through
 * the secret named here; Wheelhouse hands it the key for each call and never
 * passes it on. ElevenLabs is built in (elevenlabs.ts); a plugin can add
 * another with `registerVoiceProvider`. The browser's own voice is not a
 * provider: it needs nothing from the server.
 */
export interface VoiceProvider {
	id: string;
	label: string;
	/** One line on what it is, for Settings → Voice. */
	about: string;
	/** The vault secret holding the key, e.g. ELEVEN_LABS_KEY. */
	secret: string;
	voices: VoiceOption[];
	/** Speak `text`: audio bytes and their media type; throws on failure. */
	speak(
		key: string,
		request: { text: string; voice: string | null; speed: number },
		signal?: AbortSignal
	): Promise<{ body: ReadableStream<Uint8Array>; type: string }>;
	/** Hear a recorded clip; absent when the provider only speaks. */
	hear?(
		key: string,
		clip: { audio: Uint8Array; type: string; keyterms: string[]; from: number },
		signal?: AbortSignal
	): Promise<string>;
}

const providers = new Map<string, VoiceProvider>();

/** Add a provider (or replace one with the same id). */
export function registerVoiceProvider(provider: VoiceProvider): void {
	if (!/^[a-z][a-z0-9-]{0,31}$/.test(provider.id) || provider.id === 'browser')
		throw new Error(`A voice provider's id must be a short lowercase name: ${provider.id}`);
	providers.set(provider.id, provider);
}

export function voiceProvider(id: string): VoiceProvider | null {
	return providers.get(id) ?? null;
}

export function voiceProviders(): VoiceProvider[] {
	return [...providers.values()];
}
