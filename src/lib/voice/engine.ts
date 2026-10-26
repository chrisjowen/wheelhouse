/**
 * Speech-to-text engines for dictation. An engine turns the microphone into
 * text and knows nothing about where the text goes (see dictation.svelte.ts).
 * The browser's Web Speech API is the default because it needs no setup; a
 * private local engine (whisper.cpp behind a local endpoint, say) would be a
 * second implementation of `DictationEngine` chosen with `setDictationEngine`.
 */

/** Why dictation stopped short. */
export type DictationProblem =
	'unsupported' | 'blocked' | 'no-microphone' | 'no-speech' | 'network' | 'failed';

export interface DictationHandlers {
	/** Everything heard so far in this session: settled words, then the guess still forming. */
	text(final: string, interim: string): void;
	problem(p: DictationProblem): void;
	/** The engine has stopped listening, after `stop()`, `abort()`, a problem or a long silence. */
	end(): void;
}

export interface DictationSession {
	/** Stop listening and deliver the last words, then `end`. */
	stop(): void;
	/** Stop listening now and drop anything not yet delivered. */
	abort(): void;
}

export interface DictationEngine {
	/** Shown once before first use when audio leaves this machine; null for a local engine. */
	privacyNote: string | null;
	supported(): boolean;
	start(lang: string, on: DictationHandlers): DictationSession;
}

/** What the captain reads when dictation stops short. */
export const problemText: Record<DictationProblem, string> = {
	unsupported:
		'This browser cannot turn speech into text. Chrome and Edge can; you can still type.',
	blocked:
		'The microphone is blocked for Wheelhouse. Allow it from the icon in the address bar, then try again.',
	'no-microphone': 'No microphone was found. Connect one, then try again.',
	'no-speech': 'Nothing was heard. Try again a little closer to the microphone.',
	network: 'The browser’s speech service could not be reached. Check the connection and try again.',
	failed: 'Dictation stopped unexpectedly. Try again, or type instead.'
};

/* The parts of the Web Speech API used here (not yet in TypeScript's DOM library). */
type Alternative = { transcript: string };
type Result = { isFinal: boolean; length: number; [i: number]: Alternative };
type ResultEvent = { results: { length: number; [i: number]: Result } };
type Recognition = {
	lang: string;
	continuous: boolean;
	interimResults: boolean;
	onresult: ((e: ResultEvent) => void) | null;
	onerror: ((e: { error: string }) => void) | null;
	onend: (() => void) | null;
	start(): void;
	stop(): void;
	abort(): void;
};
type RecognitionClass = new () => Recognition;

function recognitionClass(): RecognitionClass | null {
	if (typeof window === 'undefined') return null;
	const w = window as unknown as Record<string, RecognitionClass | undefined>;
	return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const webSpeechProblem: Record<string, DictationProblem> = {
	'not-allowed': 'blocked',
	'service-not-allowed': 'blocked',
	'audio-capture': 'no-microphone',
	'no-speech': 'no-speech',
	network: 'network',
	'language-not-supported': 'unsupported'
};

/** The browser's own recognizer. Chrome sends the audio to Google to recognise it. */
export const webSpeechEngine: DictationEngine = {
	privacyNote:
		'Dictation uses your browser’s speech service. In Chrome that sends what you say to Google to turn it into text, only while the microphone is on.',
	supported: () => recognitionClass() !== null,
	start(lang, on) {
		const Class = recognitionClass();
		if (!Class) {
			on.problem('unsupported');
			on.end();
			return { stop() {}, abort() {} };
		}
		const r = new Class();
		r.lang = lang;
		r.continuous = true;
		r.interimResults = true;
		r.onresult = (e) => {
			let final = '';
			let interim = '';
			for (let i = 0; i < e.results.length; i++) {
				const res = e.results[i];
				if (res.isFinal) final += res[0].transcript;
				else interim += res[0].transcript;
			}
			on.text(final, interim);
		};
		// "aborted" is our own abort(), not a problem.
		r.onerror = (e) => {
			if (e.error !== 'aborted') on.problem(webSpeechProblem[e.error] ?? 'failed');
		};
		r.onend = () => on.end();
		try {
			r.start();
		} catch {
			on.problem('failed');
			on.end();
		}
		return { stop: () => r.stop(), abort: () => r.abort() };
	}
};

let current: DictationEngine = webSpeechEngine;

export const dictationEngine = (): DictationEngine => current;

/** Swap the engine every dictation uses (tests use a fake one). */
export function setDictationEngine(engine: DictationEngine) {
	current = engine;
}
