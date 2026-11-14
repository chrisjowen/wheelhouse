import { describe, expect, it } from 'vitest';
import { parseBlock, renderBlock, withBlock, withoutBlock } from './block';

describe('a managed block inside someone else’s file', () => {
	const block = renderBlock('wheelhouse', '1.0.0', 'line one\nline two');

	it('parses the text between its markers and nothing else', () => {
		const text = `mine\n\n${block}\nalso mine\n`;
		expect(parseBlock(text, 'wheelhouse')).toEqual({
			state: 'one',
			before: 'mine\n\n',
			body: 'line one\nline two',
			after: '\nalso mine\n'
		});
		expect(parseBlock('just mine\n', 'wheelhouse')).toEqual({ state: 'absent' });
		const empty = renderBlock('wheelhouse', '1.0.0', '');
		expect(parseBlock(empty, 'wheelhouse')).toMatchObject({ state: 'one', body: '' });
	});

	it.each([
		['a missing end marker', `${block.split('\n').slice(0, -1).join('\n')}\n`],
		['a missing begin marker', `x\n<!-- wheelhouse:end -->\n`],
		['markers twice', `${block}\n${block}\n`],
		['an end before the begin', `<!-- wheelhouse:end -->\n<!-- wheelhouse:begin v=1 -->\n`]
	])('refuses a file with %s', (_why, text) => {
		expect(parseBlock(text, 'wheelhouse').state).toBe('broken');
		expect(withBlock(text, 'wheelhouse', block)).toBeNull();
		expect(withoutBlock(text, 'wheelhouse')).toBeNull();
	});

	it('replaces only the block, appends one after a blank line, and removes it cleanly', () => {
		const next = renderBlock('wheelhouse', '2.0.0', 'new');
		expect(withBlock(`mine\n\n${block}\nafter\n`, 'wheelhouse', next)).toBe(
			`mine\n\n${next}\nafter\n`
		);
		expect(withBlock('mine\n', 'wheelhouse', next)).toBe(`mine\n\n${next}\n`);
		expect(withBlock('mine', 'wheelhouse', next)).toBe(`mine\n\n${next}\n`);
		expect(withBlock('', 'wheelhouse', next)).toBe(`${next}\n`);
		expect(withoutBlock(`mine\n\n${next}\n`, 'wheelhouse')).toBe('mine\n');
		expect(withoutBlock(`mine\n\n${next}\nafter\n`, 'wheelhouse')).toBe('mine\n\nafter\n');
	});
});
