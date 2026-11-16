import type { VoiceProvider } from './providers';

/**
 * ElevenLabs, built in: replies streamed with its fast voice model, and the
 * captain's words heard by Scribe with key terms (project and task names, the
 * fleet's own words) so they come out spelled right. The account's own voices
 * are not listed (that needs a key with more access than speaking does), so
 * the page offers ElevenLabs' stock voices.
 */

const API = 'https://api.elevenlabs.io/v1';
const TTS_MODEL = 'eleven_flash_v2_5';
const STT_MODEL = 'scribe_v1';
/** Scribe bills 100 or more key terms as at least 20 seconds; stay under that. */
export const MAX_KEYTERMS = 95;

export const ELEVENLABS_VOICES = [
	{ id: 'JBFqnCBsd6RMkjVDRZzb', name: 'George', note: 'British, warm' },
	{ id: 'onwK4e9ZLuTAKqWW03F9', name: 'Daniel', note: 'British, steady' },
	{ id: 'Xb7hH8MSUJpSbSDYk0k2', name: 'Alice', note: 'British, clear' },
	{ id: 'pFZP5JQG7iQjIQuC4Bku', name: 'Lily', note: 'British, soft' },
	{ id: 'N2lVS1w4EtoT3dr4eOWO', name: 'Callum', note: 'Gravelly' },
	{ id: 'nPczCjzI2devNBz1zQrb', name: 'Brian', note: 'American, deep' },
	{ id: 'CwhRBWXzGAHq8TQ4Fs17', name: 'Roger', note: 'American, easy' },
	{ id: 'EXAVITQu4vr4xnSDxMaL', name: 'Sarah', note: 'American, bright' },
	{ id: 'XrExE9yKIg1WjnnlVkGX', name: 'Matilda', note: 'American, warm' },
	{ id: 'IKne3meq5aSn9XLyUdCD', name: 'Charlie', note: 'Australian' },
	{ id: 'bIHbv24MWmeRgasZH58o', name: 'Will', note: 'American, relaxed' },
	{ id: 'SAz9YHcvj6GT2YYXdXww', name: 'River', note: 'Neutral' }
];

export class ProviderError extends Error {
	constructor(
		message: string,
		readonly status: number
	) {
		super(message);
	}
}

export function elevenLabs(fetcher: typeof fetch = fetch): VoiceProvider {
	return {
		id: 'elevenlabs',
		label: 'ElevenLabs',
		about: 'Natural voices, and Scribe to hear you with your project names spelled right.',
		secret: 'ELEVEN_LABS_KEY',
		voices: ELEVENLABS_VOICES,
		async speak(key, { text, voice, speed }, signal) {
			const id = ELEVENLABS_VOICES.find((v) => v.id === voice)?.id ?? ELEVENLABS_VOICES[0].id;
			const res = await fetcher(`${API}/text-to-speech/${id}/stream?output_format=mp3_44100_128`, {
				method: 'POST',
				signal,
				headers: { 'xi-api-key': key, 'content-type': 'application/json' },
				body: JSON.stringify({
					text,
					model_id: TTS_MODEL,
					voice_settings: {
						stability: 0.5,
						similarity_boost: 0.75,
						speed: Math.min(1.2, Math.max(0.7, speed))
					}
				})
			});
			if (!res.ok || !res.body)
				throw new ProviderError(`ElevenLabs answered ${res.status}`, res.status);
			return { body: res.body, type: 'audio/mpeg' };
		},
		async hear(key, { audio, type, keyterms, from }, signal) {
			const form = new FormData();
			form.append('model_id', STT_MODEL);
			form.append('language_code', 'en');
			form.append('tag_audio_events', 'false');
			for (const term of keyterms.slice(0, MAX_KEYTERMS)) form.append('keyterms', term);
			form.append('file', new Blob([new Uint8Array(audio)], { type }), 'clip');
			const res = await fetcher(`${API}/speech-to-text`, {
				method: 'POST',
				signal,
				headers: { 'xi-api-key': key },
				body: form
			});
			if (!res.ok) throw new ProviderError(`ElevenLabs answered ${res.status}`, res.status);
			const body = (await res.json()) as {
				text?: unknown;
				words?: { text?: unknown; start?: unknown }[];
			};
			// A clip recorded before the captain began (always-on listening) keeps only their words.
			if (from > 0 && Array.isArray(body.words))
				return body.words
					.filter(
						(w) => typeof w.start === 'number' && w.start >= from && typeof w.text === 'string'
					)
					.map((w) => w.text as string)
					.join('')
					.trim();
			return typeof body.text === 'string' ? body.text.trim() : '';
		}
	};
}
