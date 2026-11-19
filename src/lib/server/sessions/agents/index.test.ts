import { describe, expect, it } from 'vitest';
import { HARNESSES } from '../../../harness';
import { AGENTS } from '.';

describe('AGENTS', () => {
	it('registers one primary agent for every harness, under its own name', () => {
		expect(Object.keys(AGENTS).sort()).toEqual([...HARNESSES].sort());
		for (const [harness, agent] of Object.entries(AGENTS)) expect(agent.id).toBe(harness);
	});
});
