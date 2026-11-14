/**
 * Web addresses in a terminal, for the live terminals' links (see
 * components/firstmate/Terminal.svelte). A long address is drawn over several
 * rows, and not always as the terminal's own wrapping: Claude Code breaks its
 * sign-in address into full rows itself, and tmux redraws every row on its
 * own. So an address joins on to the next row when it fills its row to the
 * last column and the next row starts with address characters at its first
 * column, as well as across the terminal's own wraps. Clicking any of its rows
 * opens the whole address.
 */

/** One row of the terminal: each column's text ('' for the second half of a wide character). */
export interface TerminalRow {
	cells: string[];
	/** The terminal wrapped this row on from the one before. */
	wrapped: boolean;
}

/** A buffer position, 1-based, as xterm's links give it. */
export interface CellPosition {
	x: number;
	y: number;
}

export interface TerminalLink {
	url: string;
	/** The first and last cell of the address (inclusive). */
	start: CellPosition;
	end: CellPosition;
}

/** How many rows an address may span above and below the row asked about. */
const MAX_ROWS = 40;

// The characters a URL may hold (RFC 3986); anything else, a space or a box border, ends it.
const URL_CHAR = /^[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]$/;
const URL_PATTERN = /https?:\/\/[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]+/g;

const isUrlChar = (c: string | undefined) => c !== undefined && URL_CHAR.test(c);

/** The last character of a row's text, skipping the empty second halves of wide characters. */
const lastChar = (row: TerminalRow) => {
	for (let i = row.cells.length - 1; i >= 0; i--) if (row.cells[i] !== '') return row.cells[i];
	return undefined;
};

/** Whether an address on `above` may run on to `below`. */
function joins(above: TerminalRow, below: TerminalRow, cols: number): boolean {
	if (below.wrapped) return true;
	return above.cells.length >= cols && isUrlChar(lastChar(above)) && isUrlChar(below.cells[0]);
}

/** Trailing punctuation that ends a sentence, not the address; a closing bracket only unmatched. */
function trimUrl(url: string): string {
	let u = url;
	for (;;) {
		const last = u.at(-1);
		if (last && '.,;:!?\'"'.includes(last)) u = u.slice(0, -1);
		else if (last === ')' && count(u, '(') < count(u, ')')) u = u.slice(0, -1);
		else if (last === ']' && count(u, '[') < count(u, ']')) u = u.slice(0, -1);
		else return u;
	}
}
const count = (s: string, c: string) => s.split(c).length - 1;

/**
 * The addresses on buffer row `y` (1-based), each whole even where it runs on
 * over other rows. `row` gives a row by its 0-based index, or undefined past
 * the buffer.
 */
export function linksAt(
	y: number,
	cols: number,
	row: (index: number) => TerminalRow | undefined
): TerminalLink[] {
	const at = y - 1;
	const here = row(at);
	if (!here) return [];
	let first = at;
	for (let i = at; i > at - MAX_ROWS; i--) {
		const above = row(i - 1);
		const r = row(i);
		if (!above || !r || !joins(above, r, cols)) break;
		first = i - 1;
	}
	let last = at;
	for (let i = at; i < at + MAX_ROWS; i++) {
		const r = row(i);
		const below = row(i + 1);
		if (!r || !below || !joins(r, below, cols)) break;
		last = i + 1;
	}
	let text = '';
	const where: CellPosition[] = [];
	for (let i = first; i <= last; i++) {
		const cells = row(i)!.cells;
		for (let x = 0; x < cells.length; x++) {
			text += cells[x];
			for (let k = 0; k < cells[x].length; k++) where.push({ x: x + 1, y: i + 1 });
		}
	}
	const links: TerminalLink[] = [];
	for (const m of text.matchAll(URL_PATTERN)) {
		const url = trimUrl(m[0]);
		if (url.length <= 'https://'.length) continue;
		const start = where[m.index];
		const end = where[m.index + url.length - 1];
		if (start.y <= y && end.y >= y) links.push({ url, start, end });
	}
	return links;
}

/** Open an address from the terminal in a tab of its own; only http and https. */
export function openTerminalLink(
	url: string,
	open: (url: string, target: string, features: string) => unknown = (u, t, f) =>
		window.open(u, t, f)
): void {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return;
	}
	if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return;
	open(parsed.href, '_blank', 'noopener,noreferrer');
}
