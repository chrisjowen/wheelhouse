import { describe, expect, it } from 'vitest';
import { helperNotice, helperPlan } from './helperchoice';

const ready = { notice: null };

describe('the helper choice', () => {
	it('stays on Claude Code until someone chooses, and when they choose Claude Code', () => {
		expect(helperPlan(null)).toEqual({
			...ready,
			choice: null,
			runs: 'claude'
		});
		expect(helperPlan('claude')).toEqual({
			...ready,
			choice: 'claude',
			runs: 'claude'
		});
	});

	it('runs Grok when that is the helper, whatever agent Firstmate runs in', () => {
		expect(helperPlan('grok')).toEqual({
			...ready,
			choice: 'grok',
			runs: 'grok'
		});
	});

	it('says when the program that will run is not installed', () => {
		expect(helperNotice('grok', false)).toBe('Grok is not installed, so the helper cannot answer.');
		expect(helperNotice('claude', false)).toBe(
			'Claude Code is not installed, so the helper cannot answer.'
		);
		expect(helperNotice('grok', true)).toBeNull();
		expect(helperNotice('claude', true)).toBeNull();
	});
});
