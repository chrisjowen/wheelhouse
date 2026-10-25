import { createHash } from 'node:crypto';
import type { Picker } from '../../types';

/**
 * Claude Code's numbered menus, read off the Firstmate session's screen: its
 * question picker (AskUserQuestion, one tab per question, then a review),
 * permission prompts, and any other "1. … 2. …" choice it waits on. Claude
 * Code writes a question to its transcript only once it is answered, so the
 * screen is the one place an open menu can be seen. Pure: parsePicker reads a
 * `tmux capture-pane -p` dump, and pickerKeys turns a choice into the keys the
 * menu expects. Verified against Claude Code 2.1.280.
 *
 * A menu is recognised only at the bottom of the screen, with Claude Code's
 * cursor (`❯`) on one of its numbered rows and no prompt box below it, so a
 * numbered list in a reply is never mistaken for one.
 */

const OPTION = /^\s*(❯\s+)?(\d{1,2})\.\s+(?:\[([ ✔✓x])\]\s+)?(.*?)\s*$/;
const SUBMIT_ROW = /^\s*(❯\s+)?Submit\s*$/;
const SEPARATOR = /^\s*[─━-]{8,}\s*$/;
const FOOTER = /(Enter to (select|confirm)|Esc to (cancel|exit)|to navigate)/;
const TABS = /[☐☒]/;
const FREE_TEXT = /^Type something\.?$/i;

type Row = { kind: 'option'; n: number } | { kind: 'submit' };

/** The menu waiting at the bottom of `screen`, or null when there is none. */
export function parsePicker(screen: string): Picker | null {
	const lines = screen.replace(/\r/g, '').split('\n');
	let end = lines.length - 1;
	while (end >= 0 && !lines[end].trim()) end--;
	// Skip the footer and anything below the last numbered row that belongs to the menu.
	let last = end;
	while (last >= 0) {
		const l = lines[last];
		if (OPTION.test(l) || SUBMIT_ROW.test(l)) break;
		if (l.trim() && !FOOTER.test(l) && !SEPARATOR.test(l)) return null;
		last--;
	}
	if (last < 0) return null;

	// Walk up through the menu: numbered rows, their indented descriptions, Submit, separators.
	const options: Picker['options'] = [];
	const rows: { row: Row; cursor: boolean }[] = [];
	let first = last;
	let pendingDescription: string[] = [];
	for (let i = last; i >= 0; i--) {
		const l = lines[i];
		const m = OPTION.exec(l);
		if (m) {
			const n = Number(m[2]);
			options.unshift({
				n,
				label: m[4],
				description: pendingDescription.join(' ').trim(),
				checked: m[3] === undefined ? null : m[3] !== ' ',
				freeText: FREE_TEXT.test(m[4])
			});
			rows.unshift({ row: { kind: 'option', n }, cursor: !!m[1] });
			pendingDescription = [];
			first = i;
			continue;
		}
		if (SUBMIT_ROW.test(l)) {
			rows.unshift({ row: { kind: 'submit' }, cursor: /❯/.test(l) });
			pendingDescription = [];
			first = i;
			continue;
		}
		if (SEPARATOR.test(l) || !l.trim()) {
			pendingDescription = [];
			continue;
		}
		// An indented line under an option is its description; anything else ends the menu.
		if (/^\s{4,}\S/.test(l)) {
			pendingDescription.unshift(l.trim());
			continue;
		}
		break;
	}
	if (!options.length || !rows.some((r) => r.cursor)) return null;
	// Numbered rows must count up from 1, as Claude Code's menus do.
	if (options.some((o, i) => o.n !== i + 1)) return null;

	// Above the menu: the question (or prompt) text, and the question tabs if any.
	const title: string[] = [];
	let tabs: Picker['tabs'] = [];
	for (let i = first - 1; i >= 0 && title.length < 12; i--) {
		const l = lines[i];
		if (SEPARATOR.test(l)) break;
		if (TABS.test(l)) {
			tabs = [...l.matchAll(/([☐☒])\s+([^☐☒✔]+?)(?=\s{2,}|\s*[☐☒✔→]|$)/g)].map((t) => ({
				label: t[2].trim(),
				done: t[1] === '☒'
			}));
			break;
		}
		if (l.trim()) title.unshift(l.trim());
	}
	const cursorRow = rows.findIndex((r) => r.cursor);
	const submitRow = rows.findIndex((r) => r.row.kind === 'submit');
	const picker: Omit<Picker, 'signature'> = {
		title: title.join('\n'),
		tabs,
		options,
		multiSelect: options.some((o) => o.checked !== null),
		submitMoves: submitRow < 0 ? null : submitRow - cursorRow
	};
	const signature = createHash('sha256')
		.update(JSON.stringify([picker.title, picker.tabs, picker.options.map((o) => [o.n, o.label])]))
		.digest('hex')
		.slice(0, 16);
	return { ...picker, signature };
}

export type PickerAction = { press: number } | { submit: true };

/**
 * The keys that make `action` on `picker`: an option's digit (which picks a
 * single-choice option, or toggles a multi-choice one), or, for a
 * multi-choice question, moving the cursor to its Submit row and pressing
 * Enter. Null when the action does not fit the menu.
 */
export function pickerKeys(picker: Picker, action: PickerAction): string[] | null {
	if ('press' in action) {
		const o = picker.options.find((x) => x.n === action.press);
		if (!o || o.freeText || o.n > 9) return null;
		return [String(o.n)];
	}
	if (picker.submitMoves === null) return null;
	const k = picker.submitMoves;
	return [...Array(Math.abs(k)).fill(k > 0 ? 'Down' : 'Up'), 'Enter'];
}
