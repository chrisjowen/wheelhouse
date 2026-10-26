import type { DictationEngine, DictationHandlers, DictationProblem } from './engine';

/** A recognizer the tests drive by hand: say words, raise problems, end. */
export class FakeEngine implements DictationEngine {
	privacyNote: string | null = null;
	available = true;
	/** Handlers of the session listening now, if any. */
	on: DictationHandlers | null = null;
	starts = 0;
	stops = 0;
	aborts = 0;
	/** Problem to raise as soon as listening starts (a blocked microphone, say). */
	failWith: DictationProblem | null = null;

	supported() {
		return this.available;
	}

	start(_lang: string, on: DictationHandlers) {
		this.starts++;
		this.on = on;
		if (this.failWith) {
			on.problem(this.failWith);
			this.on = null;
			on.end();
		}
		return {
			stop: () => {
				this.stops++;
			},
			abort: () => {
				this.aborts++;
				if (this.on === on) this.on = null;
			}
		};
	}

	/** Hear words: settled text so far, and the guess still forming. */
	hear(final: string, interim = '') {
		this.on?.text(final, interim);
	}

	end() {
		const on = this.on;
		this.on = null;
		on?.end();
	}
}
