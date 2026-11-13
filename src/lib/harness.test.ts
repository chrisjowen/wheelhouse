import { describe, expect, it } from 'vitest';
import { HARNESSES, parseHarness } from './harness';

describe('harness selection', () => {
	it('defaults to Claude and accepts the supported executable names', () => {
		expect(parseHarness()).toBe('claude');
		for (const harness of HARNESSES) expect(parseHarness(harness)).toBe(harness);
	});
	it.each(['', 'unknown', 'codex --dangerously-bypass-approvals-and-sandbox', '../pi'])(
		'rejects %j',
		(value) => {
			expect(() => parseHarness(value)).toThrow('Unknown harness');
		}
	);
});
