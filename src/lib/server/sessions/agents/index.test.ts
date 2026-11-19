import { describe, expect, it } from 'vitest';
import { HARNESSES } from '../../../harness';
import { AGENTS } from '.';

describe('AGENTS', () => {
	it('registers each primary agent under its own harness, and only known harnesses', () => {
		for (const [harness, agent] of Object.entries(AGENTS)) {
			expect(HARNESSES).toContain(harness);
			expect(agent.id).toBe(harness);
		}
	});
});
