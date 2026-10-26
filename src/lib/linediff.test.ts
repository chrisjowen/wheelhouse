import { describe, expect, it } from 'vitest';
import { diffLines, linesOf } from './linediff';

describe('diffLines', () => {
	it('marks kept, added and removed lines', () => {
		const d = diffLines(linesOf('a\nb\nc\nd\n'), linesOf('a\nc\nx\nd\n'));
		expect(d.map((x) => `${x.op}${x.text}`)).toEqual([' a', '-b', ' c', '+x', ' d']);
		expect(d.filter((x) => x.op === ' ').map((x) => x.from)).toEqual([0, 2, 3]);
	});

	it('handles empty sides', () => {
		expect(diffLines([], ['a']).map((x) => x.op)).toEqual(['+']);
		expect(diffLines(['a'], []).map((x) => x.op)).toEqual(['-']);
		expect(linesOf('')).toEqual([]);
	});
});
