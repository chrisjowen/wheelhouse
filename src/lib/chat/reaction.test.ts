import { describe, expect, it } from 'vitest';
import { reactionText } from './reaction';

describe('reactionText', () => {
	it('quotes the first line of the message as plain text', () => {
		expect(reactionText('The scout found it: the **40% growth**.\n\nMore detail here.')).toBe(
			'👍 on: “The scout found it: the 40% growth.”'
		);
	});

	it('skips blank lines and thread markers', () => {
		expect(reactionText('\n<!-- project: wh -->\n## Shipped\nrest')).toBe('👍 on: “Shipped”');
	});

	it('cuts a long first line with an ellipsis', () => {
		const note = reactionText('word '.repeat(60));
		expect(note.startsWith('👍 on: “word word')).toBe(true);
		expect(note.endsWith('…”')).toBe(true);
		expect(note.length).toBeLessThan(115);
	});

	it('is empty for a message without words', () => {
		expect(reactionText('  \n\n')).toBe('');
	});
});
