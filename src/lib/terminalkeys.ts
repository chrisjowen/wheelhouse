/**
 * The terminal's key bar: the keys a phone's keyboard lacks (Esc, Tab, Ctrl,
 * the arrows), as the bytes a terminal sends for them. They travel the same
 * way as typed input (a TerminalMessage of type 'input').
 *
 * Ctrl is sticky: tapped, it arms, and the next key (from the bar or typed on
 * the phone's keyboard) goes as Ctrl plus that key, after which it disarms.
 * Tapping it again while armed disarms it without sending anything.
 */

export type BarKey = 'esc' | 'tab' | 'ctrl-c' | 'left' | 'up' | 'down' | 'right';

const ARROWS = { up: 'A', down: 'B', right: 'C', left: 'D' } as const;

export interface BarKeyOptions {
	/** Ctrl is armed: the key goes as Ctrl plus that key. */
	ctrl?: boolean;
	/**
	 * The terminal is in application cursor mode (DECCKM, which tmux and full-screen
	 * programs turn on), where an arrow is ESC O x rather than ESC [ x.
	 */
	applicationCursor?: boolean;
}

/** The bytes a bar key sends. */
export function barKeySequence(
	key: BarKey,
	{ ctrl = false, applicationCursor = false }: BarKeyOptions = {}
): string {
	switch (key) {
		case 'esc':
			return '\x1b';
		case 'tab':
			return '\t';
		case 'ctrl-c':
			return '\x03';
		default: {
			const final = ARROWS[key];
			// Ctrl+arrow is ESC [ 1 ; 5 x in either cursor mode, as xterm sends it.
			if (ctrl) return `\x1b[1;5${final}`;
			return `${applicationCursor ? '\x1bO' : '\x1b['}${final}`;
		}
	}
}

/**
 * Ctrl plus one typed character: a letter becomes its control code (c is ETX,
 * 0x03), and so do @ [ \ ] ^ _ (and space, as Ctrl+@; ? is DEL). Anything else
 * has no control form and goes as typed.
 */
export function ctrlChar(ch: string): string {
	if (ch.length !== 1) return ch;
	const code = ch.charCodeAt(0);
	if (ch === ' ') return '\x00';
	if (ch === '?') return '\x7f';
	if (code >= 0x40 && code <= 0x5f) return String.fromCharCode(code & 0x1f); // @ A-Z [ \ ] ^ _
	if (code >= 0x61 && code <= 0x7a) return String.fromCharCode(code & 0x1f); // a-z
	return ch;
}

/**
 * Typed input while Ctrl may be armed: armed, the first character goes as
 * Ctrl plus that character and the rest as typed, and Ctrl disarms. An
 * escape sequence (a mouse or focus report the terminal sends itself) goes
 * as it is and leaves Ctrl armed for the next typed key.
 */
export function typedInput(data: string, ctrl: boolean): { data: string; ctrl: boolean } {
	if (!ctrl || !data || (data.startsWith('\x1b') && data.length > 1)) return { data, ctrl };
	const [first, ...rest] = [...data];
	return { data: ctrlChar(first) + rest.join(''), ctrl: false };
}

/** A bar key's bytes, and Ctrl disarmed by it. */
export function barKeyInput(
	key: BarKey,
	options: BarKeyOptions = {}
): { data: string; ctrl: boolean } {
	return { data: barKeySequence(key, options), ctrl: false };
}

/** Just enough of the browser's VisualViewport to find the on-screen keyboard. */
export interface ViewportBox {
	readonly height: number;
	readonly offsetTop: number;
}

/**
 * How many pixels at the bottom of an element are behind the on-screen
 * keyboard. Phones' browsers keep the page's layout full height while the
 * keyboard is up and only the visual viewport shrinks, so an element pinned
 * to the bottom of the page sits under the keyboard by this much. `bottom` is
 * the element's bottom edge in the layout viewport (getBoundingClientRect).
 */
export function keyboardCover(bottom: number, viewport: ViewportBox): number {
	const visibleBottom = viewport.offsetTop + viewport.height;
	return Math.max(0, Math.round(bottom - visibleBottom));
}
