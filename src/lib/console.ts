import type { TaskOutput } from './types';

/**
 * Worker consoles are read-only captures of a pane Wheelhouse does not own
 * (fm-peek.sh), so they cannot be resized to fit the screen. Full screen
 * renders the capture larger instead: the font grows until the pane's width
 * fills the viewport, and the rows that fit follow from it.
 */

/** How often each live console asks for new output while it is on screen. */
export const CONSOLE_POLL_MS = {
	/** The full-screen console is the one the captain is watching. */
	full: 1_000,
	/** A card's or the task page's console window. */
	window: 2_000,
	/** The Log tab's raw output, while it is open. */
	inspector: 2_000
} as const;

/** A pane is never narrower than a classic terminal, so short captures do not balloon. */
export const MIN_CONSOLE_COLS = 80;
export const CONSOLE_LINE_HEIGHT = 1.45;
const MIN_FONT_PX = 11;
const MAX_FONT_PX = 32;

/** How wide the pane that produced these lines is, in columns. */
export function consoleColumns(lines: readonly string[]): number {
	let widest = 0;
	for (const line of lines) widest = Math.max(widest, [...line.trimEnd()].length);
	return Math.max(MIN_CONSOLE_COLS, widest);
}

export interface ConsoleFit {
	fontSize: number;
	cols: number;
	rows: number;
}

/**
 * The font size that makes `cols` columns fill `width` pixels (bounded, so a
 * very wide pane on a small screen scrolls rather than shrinking past
 * reading), and how many rows of that size fit in `height`. `charWidth` is a
 * monospace cell's width as a fraction of the font size (about 0.6).
 */
export function fitConsole(opts: {
	width: number;
	height: number;
	cols: number;
	charWidth: number;
	lineHeight?: number;
}): ConsoleFit {
	const lineHeight = opts.lineHeight ?? CONSOLE_LINE_HEIGHT;
	const cols = Math.max(1, Math.floor(opts.cols));
	const ideal = opts.width / (cols * (opts.charWidth > 0 ? opts.charWidth : 0.6));
	const bounded = Number.isFinite(ideal) ? Math.min(MAX_FONT_PX, Math.max(MIN_FONT_PX, ideal)) : 13;
	// Whole tenths of a pixel, rounded down so the widest line never overflows.
	const fontSize = Math.floor(bounded * 10) / 10;
	const rows = Math.max(1, Math.floor(Math.max(0, opts.height) / (fontSize * lineHeight)));
	return { fontSize, cols, rows };
}

/** Just enough of `Document` to pause while the page is hidden and resume when it returns. */
export interface Visibility {
	readonly hidden: boolean;
	addEventListener(type: 'visibilitychange', listener: () => void): void;
	removeEventListener(type: 'visibilitychange', listener: () => void): void;
}

export interface PollOptions<T> {
	load: () => Promise<T>;
	intervalMs: number;
	onresult: (value: T) => void;
	onerror: (e: Error) => void;
	doc: Visibility;
}

/**
 * Load now and then every `intervalMs` after the last load finished (so a
 * slow server never piles requests up). Nothing loads while the page is
 * hidden; coming back loads at once rather than waiting out the interval.
 * Returns a stop function.
 */
export function poll<T>({ load, intervalMs, onresult, onerror, doc }: PollOptions<T>): () => void {
	let stopped = false;
	let busy = false;
	let timer: ReturnType<typeof setTimeout> | undefined;
	const schedule = () => {
		clearTimeout(timer);
		if (!stopped) timer = setTimeout(tick, intervalMs);
	};
	const tick = async () => {
		if (stopped || busy) return;
		if (doc.hidden) return schedule();
		busy = true;
		try {
			const value = await load();
			if (!stopped) onresult(value);
		} catch (e) {
			if (!stopped) onerror(e instanceof Error ? e : new Error(String(e)));
		} finally {
			busy = false;
		}
		schedule();
	};
	const onvisible = () => {
		if (!doc.hidden && !busy) {
			clearTimeout(timer);
			void tick();
		}
	};
	doc.addEventListener('visibilitychange', onvisible);
	void tick();
	return () => {
		stopped = true;
		clearTimeout(timer);
		doc.removeEventListener('visibilitychange', onvisible);
	};
}

/** Poll a task's bounded terminal output (GET /api/tasks/:id/output). */
export function pollTaskOutput(
	taskId: string,
	lines: number,
	intervalMs: number,
	handlers: { onresult: (out: TaskOutput) => void; onerror: (e: Error) => void },
	doc: Visibility = document
): () => void {
	const url = `/api/tasks/${encodeURIComponent(taskId)}/output?lines=${lines}`;
	return poll({
		load: async () => {
			const r = await fetch(url);
			if (!r.ok) throw new Error(`HTTP ${r.status}`);
			return (await r.json()) as TaskOutput;
		},
		intervalMs,
		doc,
		...handlers
	});
}
