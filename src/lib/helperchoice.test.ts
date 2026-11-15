import { describe, expect, it } from 'vitest';
import { helperNotice, helperPlan } from './helperchoice';

const ready = { notice: null };

describe('the helper choice', () => {
	it('stays on Claude Code until someone chooses, and when they choose Claude Code', () => {
		expect(helperPlan(null, 'grok')).toEqual({
			...ready,
			choice: null,
			runs: 'claude',
			fallback: null
		});
		expect(helperPlan('claude', 'grok')).toEqual({
			...ready,
			choice: 'claude',
			runs: 'claude',
			fallback: null
		});
		expect(helperPlan('claude', 'codex').runs).toBe('claude');
		expect(helperPlan('claude', 'pi').runs).toBe('claude');
		expect(helperPlan('claude', 'opencode').runs).toBe('claude');
	});

	it('runs Grok when that is the helper, whatever agent Firstmate runs in', () => {
		for (const harness of ['claude', 'grok', 'codex', 'pi', 'opencode'] as const) {
			expect(helperPlan('grok', harness)).toEqual({
				...ready,
				choice: 'grok',
				runs: 'grok',
				fallback: null
			});
		}
	});

	it('follows an older same save, and says so when the agent has no helper of its own', () => {
		expect(helperPlan('same', 'grok')).toEqual({
			...ready,
			choice: 'same',
			runs: 'grok',
			fallback: null
		});
		expect(helperPlan('same', 'claude')).toEqual({
			...ready,
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

	it('says when the program that will run is not installed, ahead of not signed in', () => {
		expect(helperNotice('grok', false, true)).toBe(
			'Grok is not installed, so the helper cannot answer.'
		);
		expect(helperNotice('claude', false, false)).toBe(
			'Claude Code is not installed, so the helper cannot answer.'
		);
		expect(helperNotice('claude', true, false)).toBe(
			'Claude Code is not signed in, so the helper cannot answer.'
		);
		expect(helperNotice('grok', true, false)).toBe(
			'Grok is not signed in, so the helper cannot answer.'
		);
		expect(helperNotice('grok', true, true)).toBeNull();
	});
});
