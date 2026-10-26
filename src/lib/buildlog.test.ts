import { describe, expect, it } from 'vitest';
import { hintLine } from './buildlog';

describe('card hint line', () => {
	it('says nothing when there is nothing to say', () => {
		expect(hintLine(null)).toBeNull();
		expect(hintLine({ questions: 0, open: 0, docs: 0, docsChanged: 0 })).toBeNull();
	});

	it('counts the docs referenced, and how many of them changed', () => {
		expect(hintLine({ questions: 0, open: 0, docs: 5, docsChanged: 2 })).toEqual({
			questions: null,
			docs: '5 docs referenced · 2 changed'
		});
		expect(hintLine({ questions: 0, open: 0, docs: 1, docsChanged: 0 })).toEqual({
			questions: null,
			docs: '1 doc referenced'
		});
	});

	it('counts questions answered and still open', () => {
		expect(hintLine({ questions: 3, open: 1, docs: 0, docsChanged: 0 })).toEqual({
			questions: '2 questions answered, 1 open',
			docs: null
		});
		expect(hintLine({ questions: 1, open: 1, docs: 2, docsChanged: 2 })).toEqual({
			questions: '1 question open',
			docs: '2 docs referenced · 2 changed'
		});
		expect(hintLine({ questions: 2, open: 0, docs: 0, docsChanged: 0 })?.questions).toBe(
			'2 questions answered'
		);
	});
});
