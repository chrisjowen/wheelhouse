import { describe, expect, it } from 'vitest';
import { BRIEFING_MIN_CHARS, isBriefing } from './briefing';

const long = (s: string) => s + ' More words.'.repeat(Math.ceil(BRIEFING_MIN_CHARS / 10));

describe('isBriefing', () => {
	it('is a long reply with a list', () => {
		expect(isBriefing(long('Here is the plan:\n\n- **Export**: one thing\n- Sharing\n'))).toBe(
			true
		);
		expect(isBriefing(long('Steps:\n\n1. First\n2. Second\n'))).toBe(true);
	});
	it('is a long reply with a heading', () => {
		expect(isBriefing(long('## Where things stand\n\nAll quiet.'))).toBe(true);
	});
	it('is not a short reply, however structured', () => {
		expect(isBriefing('- one\n- two')).toBe(false);
	});
	it('is not a long reply of plain paragraphs', () => {
		expect(isBriefing(long('Just a long paragraph, nothing more.'))).toBe(false);
	});
	it('does not take a hyphenated word or a hashtag for structure', () => {
		expect(isBriefing(long('A well-known fix -- and #42 is done.'))).toBe(false);
	});
	it('is nothing without text', () => {
		expect(isBriefing(null)).toBe(false);
		expect(isBriefing('')).toBe(false);
	});
});
