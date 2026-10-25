import { describe, expect, it } from 'vitest';
import { parsePicker, pickerKeys } from './picker';

// Screens as `tmux capture-pane -p` shows Claude Code 2.1.280 (made-up questions).
const RULE = '─'.repeat(60);
const screen = (...lines: string[]) => [...lines, '', '', ''].join('\n');

const SINGLE = screen(
	'❯ Ask me two things.',
	RULE,
	'←  ☐ Colour  ☐ Fruit  ✔ Submit  →',
	'Which colour?',
	'❯ 1. Red',
	'     The color red',
	'  2. Green',
	'     The color green',
	'  3. Blue',
	'     The color blue',
	'  4. Type something.',
	RULE,
	'  5. Chat about this',
	'Enter to select · Tab/Arrow keys to navigate · Esc to cancel'
);

const MULTI = screen(
	RULE,
	'←  ☒ Colour  ☐ Fruit  ✔ Submit  →',
	'Which fruits?',
	'❯ 1. [✔] Apple',
	'         A round red or green fruit',
	'  2. [ ] Banana',
	'         A yellow curved fruit',
	'  3. [ ] Cherry',
	'  4. [ ] Type something',
	'     Submit',
	RULE,
	'  5. Chat about this',
	'Enter to select · Tab/Arrow keys to navigate · Esc to cancel'
);

const REVIEW = screen(
	RULE,
	'←  ☒ Colour  ☒ Fruit  ✔ Submit  →',
	'Review your answers',
	' ● Which colour?',
	'   → Green',
	'Ready to submit your answers?',
	'❯ 1. Submit answers',
	'  2. Cancel'
);

const PERMISSION = screen(
	RULE,
	' Bash command',
	'',
	'   rm -rf build',
	'   Remove the build output',
	'',
	' Do you want to proceed?',
	' ❯ 1. Yes',
	"   2. Yes, and don't ask again for rm commands",
	'   3. No, and tell Claude what to do differently (esc)'
);

const IDLE = screen(
	'⏺ Here is the plan:',
	'  1. Build the schema',
	'  2. Write the tests',
	RULE,
	'❯ ',
	RULE,
	'  ⏵⏵ bypass permissions on (shift+tab to cycle)'
);

describe('parsePicker', () => {
	it('reads a single-choice question with its tabs and descriptions', () => {
		const p = parsePicker(SINGLE)!;
		expect(p.title).toBe('Which colour?');
		expect(p.tabs).toEqual([
			{ label: 'Colour', done: false },
			{ label: 'Fruit', done: false }
		]);
		expect(p.options.map((o) => [o.n, o.label, o.description, o.checked, o.freeText])).toEqual([
			[1, 'Red', 'The color red', null, false],
			[2, 'Green', 'The color green', null, false],
			[3, 'Blue', 'The color blue', null, false],
			[4, 'Type something.', '', null, true],
			[5, 'Chat about this', '', null, false]
		]);
		expect(p.multiSelect).toBe(false);
		expect(p.submitMoves).toBeNull();
	});

	it('reads a multi-choice question, its ticks and the way to its Submit row', () => {
		const p = parsePicker(MULTI)!;
		expect(p.title).toBe('Which fruits?');
		expect(p.tabs[0]).toEqual({ label: 'Colour', done: true });
		expect(p.multiSelect).toBe(true);
		expect(p.options.map((o) => o.checked)).toEqual([true, false, false, false, null]);
		expect(p.submitMoves).toBe(4);
	});

	it('reads the review screen and a permission prompt', () => {
		const review = parsePicker(REVIEW)!;
		expect(review.title).toBe(
			'Review your answers\n● Which colour?\n→ Green\nReady to submit your answers?'
		);
		expect(review.options.map((o) => o.label)).toEqual(['Submit answers', 'Cancel']);
		const perm = parsePicker(PERMISSION)!;
		expect(perm.title).toBe(
			'Bash command\nrm -rf build\nRemove the build output\nDo you want to proceed?'
		);
		expect(perm.options).toHaveLength(3);
	});

	it('never mistakes a numbered list in a reply, or the prompt, for a menu', () => {
		expect(parsePicker(IDLE)).toBeNull();
		expect(parsePicker(screen('  1. one', '  2. two'))).toBeNull();
		expect(parsePicker('')).toBeNull();
	});

	it('identifies a menu by its content, not by its cursor or ticks', () => {
		const ticked = MULTI.replace('[ ] Banana', '[✔] Banana');
		expect(parsePicker(ticked)!.signature).toBe(parsePicker(MULTI)!.signature);
		expect(parsePicker(SINGLE)!.signature).not.toBe(parsePicker(MULTI)!.signature);
	});
});

describe('pickerKeys', () => {
	it('presses an option’s digit', () => {
		expect(pickerKeys(parsePicker(SINGLE)!, { press: 2 })).toEqual(['2']);
		expect(pickerKeys(parsePicker(MULTI)!, { press: 3 })).toEqual(['3']);
	});

	it('moves to Submit and presses Enter for a multi-choice question', () => {
		expect(pickerKeys(parsePicker(MULTI)!, { submit: true })).toEqual([
			'Down',
			'Down',
			'Down',
			'Down',
			'Enter'
		]);
		expect(pickerKeys(parsePicker(SINGLE)!, { submit: true })).toBeNull();
	});

	it('refuses options that are not there or need typing', () => {
		expect(pickerKeys(parsePicker(SINGLE)!, { press: 9 })).toBeNull();
		expect(pickerKeys(parsePicker(SINGLE)!, { press: 4 })).toBeNull();
	});
});
