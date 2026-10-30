import { describe, expect, it } from 'vitest';
import type { SettingSpec } from './manifest';
import { parseValue, readAnswers, settingViews, showValue } from './settings';

const spec = (s: Partial<SettingSpec> & { key: string }): SettingSpec => ({
	title: s.key,
	description: null,
	type: 'text',
	required: false,
	...s
});
const labels = spec({ key: 'labels', title: 'Labels', type: 'list', default: ['ready-for-pr'] });
const mode = spec({
	key: 'mode',
	title: 'Mode',
	default: 'list',
	options: [
		{ value: 'list', label: 'Just list it' },
		{ value: 'bell', label: 'Ring the bell' }
	]
});
const assignee = spec({ key: 'assignee', title: 'Assigned to', default: '@me' });
const timeout = spec({ key: 'timeout', title: 'Timeout', type: 'number' });
const board = spec({ key: 'board', title: 'Board', required: true });

describe('declared settings', () => {
	it('reads a list from text separated by commas, once each', () => {
		expect(parseValue(labels, ' bug, ready-for-pr ,bug,, ')).toEqual({
			ok: true,
			value: ['bug', 'ready-for-pr']
		});
		expect(parseValue(labels, '')).toEqual({ ok: true, value: [] });
		expect(parseValue({ ...labels, required: true }, ' , ')).toEqual({
			ok: false,
			error: 'Labels needs at least one'
		});
	});

	it('takes one of its options, by value or by what pages call it', () => {
		expect(parseValue(mode, 'bell')).toEqual({ ok: true, value: 'bell' });
		expect(parseValue(mode, 'ring the BELL')).toEqual({ ok: true, value: 'bell' });
		expect(parseValue(mode, 'auto')).toEqual({
			ok: false,
			error: 'Mode must be one of Just list it, Ring the bell'
		});
		expect(showValue(mode, 'bell')).toBe('Ring the bell');
		expect(showValue(labels, ['a', 'b'])).toBe('a, b');
	});

	it('gives each its value from the plugins file, when it is of the setting’s type', () => {
		expect(
			settingViews([labels, mode, timeout], { labels: ['bug'], mode: 'bell', timeout: 'soon' })
		).toEqual([{ ...labels, current: ['bug'] }, { ...mode, current: 'bell' }, { ...timeout }]);
	});

	it('reads a page’s answers, keeping an empty text and list and removing an empty choice', () => {
		expect(
			readAnswers([labels, mode, assignee, timeout], {
				labels: '',
				mode: '',
				assignee: ' ',
				timeout: ''
			})
		).toEqual({
			ok: true,
			settings: { labels: [], mode: undefined, assignee: '', timeout: undefined }
		});
		expect(readAnswers([labels, mode], { labels: 'a,b', mode: 'bell' })).toEqual({
			ok: true,
			settings: { labels: ['a', 'b'], mode: 'bell' }
		});
	});

	it('refuses an answer to a setting it does not declare, a missing required one, or a wrong one', () => {
		expect(readAnswers([mode], { colour: 'red' })).toEqual({
			ok: false,
			error: 'there is no setting "colour"'
		});
		expect(readAnswers([board], { board: '' })).toEqual({ ok: false, error: 'Board is needed' });
		expect(readAnswers([timeout], { timeout: 'soon' })).toEqual({
			ok: false,
			error: 'Timeout must be a number'
		});
	});
});
