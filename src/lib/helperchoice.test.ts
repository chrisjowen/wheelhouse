import { describe, expect, it } from 'vitest';
import { helperPlan } from './helperchoice';

describe('the helper choice', () => {
	it('stays on Claude Code until someone chooses, and when they choose Claude Code', () => {
		expect(helperPlan(null, 'grok')).toEqual({ choice: null, runs: 'claude', fallback: null });
		expect(helperPlan('claude', 'grok')).toEqual({
			choice: 'claude',
			runs: 'claude',
			fallback: null
		});
	});

	it('follows Grok, and says so when the agent has no helper of its own', () => {
		expect(helperPlan('same', 'grok')).toEqual({ choice: 'same', runs: 'grok', fallback: null });
		expect(helperPlan('same', 'claude')).toEqual({
			choice: 'same',
			runs: 'claude',
			fallback: null
		});
		expect(helperPlan('same', 'codex').fallback).toBe(
			'Codex has no helper of its own, so this uses Claude Code.'
		);
		expect(helperPlan('same', 'pi').runs).toBe('claude');
		expect(helperPlan('same', 'opencode').fallback).toMatch(/OpenCode/);
	});
});
