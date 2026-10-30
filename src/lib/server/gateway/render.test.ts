import { describe, expect, it } from 'vitest';
import { localCommand, splitText } from './render';

describe('splitText', () => {
	it('keeps short text whole and splits long text at line breaks, then words', () => {
		expect(splitText('one\ntwo', 20)).toEqual(['one\ntwo']);
		expect(splitText('aaaa\nbbbb\ncccc', 9)).toEqual(['aaaa\nbbbb', 'cccc']);
		expect(splitText('word '.repeat(6).trim(), 12)).toEqual([
			'word word',
			'word word',
			'word word'
		]);
		expect(splitText('x'.repeat(25), 10)).toEqual(['x'.repeat(10), 'x'.repeat(10), 'x'.repeat(5)]);
		for (const piece of splitText('lorem ipsum '.repeat(400), 2000)) {
			expect(piece.length).toBeLessThanOrEqual(2000);
		}
	});
});

describe('localCommand', () => {
	it('answers exactly status and help, and nothing that merely starts with them', () => {
		expect(localCommand(' Status ')).toBe('status');
		expect(localCommand('HELP\n')).toBe('help');
		expect(localCommand('/help')).toBeNull();
		expect(localCommand('!status')).toBeNull();
		expect(localCommand('status of the export?')).toBeNull();
	});
});
