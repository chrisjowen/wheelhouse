/**
 * Hold Space to talk, the one push-to-talk shortcut everywhere: with the
 * pointer over the talk area, holding Space for longer than `TALK_HOLD_MS`
 * starts talking and letting go stops (and sends). A shorter press is an
 * ordinary Space. In a text box the press types its space as usual; when the
 * hold turns into talking, that space comes out again. A soft chime says the
 * mic is on, and a lower one that it is off. Framework-free so any page can
 * use it.
 */

/** How long Space must be held before it means talking, not a space. */
export const TALK_HOLD_MS = 2000;

export interface SpaceTalk {
	/** The hold passed the threshold: start listening. */
	start(): void;
	/** Space was let go (or the window lost focus) after talking began. */
	stop(): void;
	/** Whether the shortcut works right now; checked when Space goes down. */
	enabled?(): boolean;
}

let audio: AudioContext | null = null;

/** A short, soft tone: `on` rises for ready-to-talk, otherwise a lower one for done. */
export function talkChime(on: boolean) {
	try {
		audio ??= new AudioContext();
		const t = audio.currentTime;
		const osc = audio.createOscillator();
		const gain = audio.createGain();
		osc.type = 'sine';
		osc.frequency.setValueAtTime(on ? 660 : 520, t);
		osc.frequency.exponentialRampToValueAtTime(on ? 880 : 390, t + 0.12);
		gain.gain.setValueAtTime(0.0001, t);
		gain.gain.exponentialRampToValueAtTime(0.08, t + 0.02);
		gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
		osc.connect(gain).connect(audio.destination);
		osc.start(t);
		osc.stop(t + 0.24);
	} catch {
		/* no sound here: the indicator still shows */
	}
}

const editable = (t: EventTarget | null): t is HTMLElement =>
	t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA'].includes(t.tagName));

const SPACE = /[ \u00a0]/;

/** Take back the space just typed before the caret in `el`, if it is there. */
export function untypeSpace(el: HTMLElement) {
	if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
		const at = el.selectionStart ?? 0;
		if (at === 0 || at !== el.selectionEnd || !SPACE.test(el.value[at - 1])) return;
		el.setRangeText('', at - 1, at, 'end');
	} else {
		const sel = el.ownerDocument.getSelection();
		const node = sel?.anchorNode;
		const at = sel?.anchorOffset ?? 0;
		if (!sel?.isCollapsed || !(node instanceof Text) || !el.contains(node) || at === 0) return;
		if (!SPACE.test(node.data[at - 1])) return;
		node.deleteData(at - 1, 1);
		sel.collapse(node, at - 1);
	}
	el.dispatchEvent(new Event('input', { bubbles: true }));
}

/**
 * Listen for Space held over `area`. Returns a function that detaches.
 * `holdMs` is for tests.
 */
export function spaceToTalk(area: HTMLElement, talk: SpaceTalk, holdMs = TALK_HOLD_MS) {
	const win = area.ownerDocument.defaultView ?? window;
	let over = area.matches(':hover');
	let timer: ReturnType<typeof setTimeout> | null = null;
	let talking = false;

	const wait = () => {
		if (timer) clearTimeout(timer);
		timer = null;
	};
	const end = () => {
		wait();
		if (!talking) return;
		talking = false;
		talkChime(false);
		talk.stop();
	};

	const down = (e: KeyboardEvent) => {
		const space = e.code === 'Space' && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey;
		if (!space) {
			// Another key while Space is still down is fast typing, not a hold.
			if (timer) wait();
			return;
		}
		if (e.repeat) {
			// Held Space neither types a row of spaces nor scrolls while it waits.
			if (timer || talking) e.preventDefault();
			return;
		}
		if (talking || !over || (talk.enabled && !talk.enabled())) return;
		const typedIn = editable(e.target) ? e.target : null;
		wait();
		timer = setTimeout(() => {
			timer = null;
			talking = true;
			if (typedIn) untypeSpace(typedIn);
			talkChime(true);
			talk.start();
		}, holdMs);
	};
	const up = (e: KeyboardEvent) => {
		if (e.code !== 'Space') return;
		// Talking: the release is not a Space (no button press, no scroll).
		if (talking) e.preventDefault();
		end();
	};
	const enter = () => (over = true);
	const leave = () => (over = false);

	area.addEventListener('pointerenter', enter);
	area.addEventListener('pointerleave', leave);
	win.addEventListener('keydown', down);
	win.addEventListener('keyup', up);
	win.addEventListener('blur', end);
	return () => {
		end();
		area.removeEventListener('pointerenter', enter);
		area.removeEventListener('pointerleave', leave);
		win.removeEventListener('keydown', down);
		win.removeEventListener('keyup', up);
		win.removeEventListener('blur', end);
	};
}
