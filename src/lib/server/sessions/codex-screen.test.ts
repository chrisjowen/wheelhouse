import { describe, expect, it } from 'vitest';
import { codexScreen } from './codex-screen';
import { pickerKeys } from './picker';

const trust =
	"\n  Hooks need review\n  1 hook is new or changed.\n  Hooks can run outside the sandbox after you trust them.\n\n› 1. Review hooks\n  2. Trust all and continue\n  3. Continue without trusting (hooks won't run)\n\n  enter confirm · esc skip\n";

describe('Codex screen', () => {
	it('recognizes the observed native folder trust dialog without approving it automatically', () => {
		const shown = codexScreen(
			'Folder access\n/tmp/project\nTrust this folder?\n\n› 1. Trust and continue\n  2. Back to Agent Command Center\n\n  enter continue · esc back'
		);
		expect(shown.kind).toBe('picker');
	});
	it('recognizes the observed native hook review and requires deliberate arrow/Enter selection', () => {
		const shown = codexScreen(trust);
		expect(shown.kind).toBe('picker');
		if (shown.kind !== 'picker') throw new Error('expected picker');
		expect(shown.picker.title).toContain('Hooks need review');
		expect(shown.picker.options).toHaveLength(3);
		expect(pickerKeys(shown.picker, { press: 2 })).toEqual(['Down', 'Enter']);
		expect(pickerKeys(shown.picker, { press: 4 })).toBeNull();
	});
	it('binds a permission choice to the entire command and current cursor', () => {
		const shown = codexScreen(trust);
		const other = codexScreen(trust.replace('1 hook is new', '2 hooks are new'));
		if (shown.kind !== 'picker' || other.kind !== 'picker') throw new Error('expected picker');
		expect(shown.picker.signature).not.toBe(other.picker.signature);
	});
	it('recognizes an idle and busy native composer', () => {
		expect(
			codexScreen(
				'› Ask Codex to do anything\n\n  GPT-6.1-Sol · Context 100% left\n  ? for shortcuts'
			)
		).toEqual({ kind: 'prompt', busy: false });
		expect(codexScreen('Working (esc to interrupt)\n\n› \n\n  ? for shortcuts')).toEqual({
			kind: 'prompt',
			busy: true
		});
	});
	it.each([
		null,
		'',
		'Login to Codex\nPress enter',
		'Would you like to proceed?\n› 1. Yes\n  2. No',
		'› unsent user text\n  ? for shortcuts',
		'› a reply quote\n\nlogin dialog\n\nenter confirm · esc cancel'
	])('blocks missing, unknown, pending-input and unproven screens: %j', (text) => {
		expect(codexScreen(text).kind).toBe('blocked');
	});
});
