import { describe, expect, it } from 'vitest';
import { barKeyInput, barKeySequence, ctrlChar, keyboardCover, typedInput } from './terminalkeys';

describe('barKeySequence', () => {
	it('sends Esc, Tab and Ctrl+C as their control bytes', () => {
		expect(barKeySequence('esc')).toBe('\x1b');
		expect(barKeySequence('tab')).toBe('\t');
		expect(barKeySequence('ctrl-c')).toBe('\x03');
	});

	it('sends the arrows as normal cursor keys', () => {
		expect(barKeySequence('up')).toBe('\x1b[A');
		expect(barKeySequence('down')).toBe('\x1b[B');
		expect(barKeySequence('right')).toBe('\x1b[C');
		expect(barKeySequence('left')).toBe('\x1b[D');
	});

	it('sends the arrows as application cursor keys when the terminal asks for them', () => {
		const o = { applicationCursor: true };
		expect(barKeySequence('up', o)).toBe('\x1bOA');
		expect(barKeySequence('down', o)).toBe('\x1bOB');
		expect(barKeySequence('right', o)).toBe('\x1bOC');
		expect(barKeySequence('left', o)).toBe('\x1bOD');
	});

	it('sends Ctrl+arrow with the Ctrl modifier in either cursor mode', () => {
		expect(barKeySequence('up', { ctrl: true })).toBe('\x1b[1;5A');
		expect(barKeySequence('left', { ctrl: true, applicationCursor: true })).toBe('\x1b[1;5D');
	});

	it('leaves Esc, Tab and Ctrl+C as they are with Ctrl armed', () => {
		expect(barKeySequence('esc', { ctrl: true })).toBe('\x1b');
		expect(barKeySequence('tab', { ctrl: true })).toBe('\t');
		expect(barKeySequence('ctrl-c', { ctrl: true })).toBe('\x03');
	});
});

describe('ctrlChar', () => {
	it('turns letters, either case, into their control codes', () => {
		expect(ctrlChar('c')).toBe('\x03');
		expect(ctrlChar('C')).toBe('\x03');
		expect(ctrlChar('a')).toBe('\x01');
		expect(ctrlChar('z')).toBe('\x1a');
		expect(ctrlChar('d')).toBe('\x04');
	});

	it('turns the punctuation with a control form into it', () => {
		expect(ctrlChar('@')).toBe('\x00');
		expect(ctrlChar(' ')).toBe('\x00');
		expect(ctrlChar('[')).toBe('\x1b');
		expect(ctrlChar('\\')).toBe('\x1c');
		expect(ctrlChar(']')).toBe('\x1d');
		expect(ctrlChar('^')).toBe('\x1e');
		expect(ctrlChar('_')).toBe('\x1f');
		expect(ctrlChar('?')).toBe('\x7f');
	});

	it('leaves anything without a control form as typed', () => {
		expect(ctrlChar('1')).toBe('1');
		expect(ctrlChar('é')).toBe('é');
		expect(ctrlChar('\r')).toBe('\r');
	});
});

describe('sticky Ctrl', () => {
	it('passes typed input through while Ctrl is not armed', () => {
		expect(typedInput('hello', false)).toEqual({ data: 'hello', ctrl: false });
	});

	it('applies Ctrl to the next typed key, then disarms', () => {
		const first = typedInput('c', true);
		expect(first).toEqual({ data: '\x03', ctrl: false });
		expect(typedInput('c', first.ctrl)).toEqual({ data: 'c', ctrl: false });
	});

	it('applies Ctrl only to the first character of a longer input', () => {
		expect(typedInput('lo', true)).toEqual({ data: '\x0co', ctrl: false });
	});

	it('stays armed through empty input', () => {
		expect(typedInput('', true)).toEqual({ data: '', ctrl: true });
	});

	it('passes the terminal\'s own mouse and focus reports through and stays armed', () => {
		const mouse = '\x1b[<0;5;10M';
		expect(typedInput(mouse, true)).toEqual({ data: mouse, ctrl: true });
		expect(typedInput('\x1b[I', true)).toEqual({ data: '\x1b[I', ctrl: true });
		expect(typedInput('\x1b[O', true)).toEqual({ data: '\x1b[O', ctrl: true });
		expect(typedInput('c', true)).toEqual({ data: '\x03', ctrl: false });
	});

	it('is disarmed by a bar key, which takes Ctrl with it', () => {
		expect(barKeyInput('up', { ctrl: true })).toEqual({ data: '\x1b[1;5A', ctrl: false });
		expect(barKeyInput('esc', { ctrl: true })).toEqual({ data: '\x1b', ctrl: false });
	});
});

describe('keyboardCover', () => {
	it('is nothing while the keyboard is down', () => {
		expect(keyboardCover(800, { height: 800, offsetTop: 0 })).toBe(0);
	});

	it('is how far the element reaches under the keyboard', () => {
		expect(keyboardCover(800, { height: 500, offsetTop: 0 })).toBe(300);
	});

	it('allows for the page having scrolled the visual viewport down', () => {
		expect(keyboardCover(800, { height: 500, offsetTop: 120 })).toBe(180);
	});

	it('is nothing for an element that ends above the keyboard', () => {
		expect(keyboardCover(400, { height: 500, offsetTop: 0 })).toBe(0);
	});
});
