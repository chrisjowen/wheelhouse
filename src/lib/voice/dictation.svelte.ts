import { dictationEngine, type DictationProblem, type DictationSession } from './engine';

/**
 * Dictation into a text box: one at a time across the app. Words appear in the
 * box as they are heard, the guess still forming shown apart, and stay there
 * as ordinary editable text; nothing is ever sent. Stopping keeps the words,
 * Esc (`cancel`) puts the box back as it was, and typing takes over (`commit`).
 */

/** Where dictated words go: a textarea, an input or the chat composer. */
export interface DictationTarget {
	/** Remember where the words go (the caret, or the end). */
	begin(): void;
	/** Show what has been heard so far in place of what was shown before. */
	show(settled: string, forming: string): void;
	/** Keep what is shown as ordinary text. */
	finish(): void;
	/** Put the box back as it was before `begin`. */
	revert(): void;
}

/** How long stopping waits for the engine's last words before keeping what it has. */
const STOP_GRACE_MS = 2000;

class Dictation {
	/** Which mic button is dictating, or last reported a problem. */
	owner = $state.raw<object | null>(null);
	phase = $state<'idle' | 'listening' | 'stopping'>('idle');
	startedAt = $state(0);
	problem = $state<DictationProblem | null>(null);

	#session: DictationSession | null = null;
	#target: DictationTarget | null = null;
	#grace: ReturnType<typeof setTimeout> | null = null;

	/** Whether `owner` is listening (or finishing up). */
	active(owner: object) {
		return this.owner === owner && this.phase !== 'idle';
	}

	start(owner: object, target: DictationTarget, lang = defaultLang()) {
		if (this.phase !== 'idle') this.commit();
		const engine = dictationEngine();
		this.owner = owner;
		this.problem = null;
		if (!engine.supported()) {
			this.problem = 'unsupported';
			return;
		}
		this.#target = target;
		target.begin();
		this.phase = 'listening';
		this.startedAt = Date.now();
		let session: DictationSession | null = null;
		const mine = () => session === null || this.#session === session;
		session = engine.start(lang, {
			text: (final, interim) => {
				if (mine() && this.#target === target) target.show(...tidy(final, interim));
			},
			problem: (p) => {
				if (mine()) this.problem = p;
			},
			end: () => {
				if (mine() && this.#target === target) this.#settle('finish');
			}
		});
		if (this.#target === target) this.#session = session;
	}

	/** Stop listening; the last words still arrive, then the box keeps them. */
	stop() {
		if (this.phase !== 'listening') return;
		this.phase = 'stopping';
		this.#session?.stop();
		this.#grace = setTimeout(() => this.#settle('finish'), STOP_GRACE_MS);
	}

	/** Keep what is shown now and stop listening. */
	commit() {
		if (this.phase !== 'idle') this.#settle('finish');
	}

	/** Stop listening and put the box back as it was. */
	cancel() {
		if (this.phase !== 'idle') this.#settle('revert');
	}

	dismiss() {
		this.problem = null;
	}

	#settle(how: 'finish' | 'revert') {
		const session = this.#session;
		const target = this.#target;
		this.#session = null;
		this.#target = null;
		if (this.#grace) clearTimeout(this.#grace);
		this.#grace = null;
		this.phase = 'idle';
		session?.abort();
		target?.[how]();
	}
}

export const dictation = new Dictation();

function defaultLang() {
	return typeof navigator !== 'undefined' && navigator.language ? navigator.language : 'en-US';
}

/** Engines return words with stray spacing; keep single spaces and no leading space. */
export function tidy(final: string, interim: string): [string, string] {
	const settled = final.replace(/\s+/g, ' ').trim();
	const forming = interim.replace(/\s+/g, ' ').trim();
	return [settled, settled && forming ? ` ${forming}` : forming];
}

/** The space to put before dictated words so they do not run into what is there. */
const lead = (before: string) => (before && !/\s$/.test(before) ? ' ' : '');
/** And after, when the caret sat before a word. */
const trail = (after: string) => (/^[\p{L}\p{N}]/u.test(after) ? ' ' : '');

/**
 * A textarea or input. Writes go through the element's value and an `input`
 * event, so a Svelte `bind:value` follows them.
 */
export function fieldTarget(el: HTMLTextAreaElement | HTMLInputElement): DictationTarget {
	let original = '';
	let before = '';
	let after = '';
	let shown = false;
	const write = (value: string, caret: number) => {
		el.value = value;
		try {
			el.setSelectionRange(caret, caret);
		} catch {
			/* some input types have no selection */
		}
		el.dispatchEvent(new Event('input', { bubbles: true }));
	};
	return {
		begin() {
			original = el.value;
			const s = el.selectionStart ?? original.length;
			const e = el.selectionEnd ?? s;
			before = original.slice(0, s);
			after = original.slice(e);
			shown = false;
		},
		show(settled, forming) {
			const text = settled + forming;
			if (!text) return;
			const head = before + lead(before) + text;
			write(head + trail(after) + after, head.length);
			shown = true;
		},
		// The words are already in the box.
		finish() {},
		revert() {
			if (shown) write(original, before.length);
			shown = false;
		}
	};
}

/**
 * A contenteditable box (the chat composer). Words go into a marked span at
 * the caret, the guess still forming in a muted inner span; finishing turns
 * the span into plain text. `changed` runs after every change, so the box can
 * recheck whether it is empty.
 */
export function editableTarget(editor: HTMLElement, changed: () => void): DictationTarget {
	let span: HTMLSpanElement | null = null;
	let space = '';
	const caretAfter = (n: Node) => {
		const r = document.createRange();
		r.setStartAfter(n);
		r.collapse(true);
		const sel = window.getSelection();
		sel?.removeAllRanges();
		sel?.addRange(r);
	};
	return {
		begin() {
			const sel = window.getSelection();
			let range: Range;
			if (sel?.rangeCount && editor.contains(sel.getRangeAt(0).startContainer)) {
				range = sel.getRangeAt(0);
				range.deleteContents();
			} else {
				range = document.createRange();
				range.selectNodeContents(editor);
				range.collapse(false);
			}
			const head = document.createRange();
			head.setStart(editor, 0);
			head.setEnd(range.startContainer, range.startOffset);
			space = lead(head.toString().replace(/\u00a0/g, ' '));
			span = document.createElement('span');
			span.dataset.dictation = '';
			range.insertNode(span);
		},
		show(settled, forming) {
			if (!span) return;
			const words = document.createTextNode(settled || forming ? space + settled : '');
			const guess = document.createElement('span');
			guess.className = 'dictation-forming';
			guess.textContent = forming;
			span.replaceChildren(words, ...(forming ? [guess] : []));
			changed();
		},
		finish() {
			if (!span) return;
			const text = span.textContent ?? '';
			if (text) {
				const node = document.createTextNode(text);
				span.replaceWith(node);
				if (editor.contains(document.activeElement) || document.activeElement === editor)
					caretAfter(node);
			} else span.remove();
			span = null;
			changed();
		},
		revert() {
			span?.remove();
			span = null;
			changed();
		}
	};
}

const isShortcut = (e: KeyboardEvent) =>
	e.code === 'Space' && e.shiftKey && (e.metaKey || e.ctrlKey) && !e.altKey;

/** Holding the shortcut at least this long means push-to-talk: letting go stops. */
const HOLD_MS = 450;

/**
 * Keyboard control for one box: Ctrl/⌘+Shift+Space starts or stops dictating
 * (held down, it listens until let go), Esc cancels, and any other key keeps
 * the words and hands the box back to typing. `start` begins dictating (the
 * mic button may first ask). Returns a function that detaches.
 */
export function dictationKeys(el: HTMLElement, owner: object, start: () => void): () => void {
	let pressedAt = 0;
	const down = (e: KeyboardEvent) => {
		if (isShortcut(e)) {
			e.preventDefault();
			if (e.repeat) return;
			if (dictation.active(owner)) {
				pressedAt = 0;
				dictation.stop();
			} else {
				pressedAt = Date.now();
				start();
			}
			return;
		}
		if (!dictation.active(owner)) return;
		if (e.key === 'Escape') {
			e.preventDefault();
			e.stopPropagation();
			pressedAt = 0;
			dictation.cancel();
		} else if (!['Shift', 'Control', 'Meta', 'Alt', 'CapsLock'].includes(e.key)) {
			pressedAt = 0;
			dictation.commit();
		}
	};
	// macOS sends no keyup for Space while ⌘ is down, so letting go of any key in the chord counts.
	const up = (e: KeyboardEvent) => {
		if (!pressedAt || !(e.code === 'Space' || ['Shift', 'Meta', 'Control'].includes(e.key))) return;
		const held = Date.now() - pressedAt;
		pressedAt = 0;
		if (held >= HOLD_MS && dictation.active(owner)) dictation.stop();
	};
	el.addEventListener('keydown', down);
	el.addEventListener('keyup', up);
	return () => {
		el.removeEventListener('keydown', down);
		el.removeEventListener('keyup', up);
	};
}
