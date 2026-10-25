import { describe, expect, it } from 'vitest';
import { extractUrls } from './urls';

describe('extractUrls', () => {
	it('extracts URLs without trailing punctuation', () => {
		expect(
			extractUrls('PR is up (https://github.com/o/r/pull/7). Preview: http://127.0.0.1:4310/.')
		).toEqual(['https://github.com/o/r/pull/7', 'http://127.0.0.1:4310/']);
	});

	it('finds nothing in plain text', () => {
		expect(extractUrls('no links here')).toEqual([]);
	});
});
