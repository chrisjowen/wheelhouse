import { describe, expect, it } from 'vitest';
import { chipLabel, compose, expandRef, parseRefs, type Ref } from './refs';

const task: Ref = {
	kind: 'task',
	id: 'wh-chat',
	title: 'One-pane chat',
	project: 'wheelhouse',
	url: null
};
const pr: Ref = { ...task, kind: 'pr', url: 'https://github.com/o/r/pull/12' };

describe('references', () => {
	it('expands a chip into the task id and title Firstmate can act on', () => {
		expect(expandRef(task)).toBe('[task wh-chat: One-pane chat]');
		expect(expandRef(pr)).toBe('[PR https://github.com/o/r/pull/12 — task wh-chat: One-pane chat]');
	});

	it('composes text and chips into the message Firstmate receives', () => {
		expect(compose(['Compare ', task, '\u00a0with ', pr, ' please  '])).toBe(
			'Compare [task wh-chat: One-pane chat] with [PR https://github.com/o/r/pull/12 — task wh-chat: One-pane chat] please'
		);
	});

	it('labels chips briefly', () => {
		expect(chipLabel(task)).toBe('# One-pane chat');
		expect(chipLabel(pr)).toBe('PR #12 One-pane chat');
		expect(chipLabel({ ...task, title: 'x'.repeat(50) }, 10)).toBe(`# ${'x'.repeat(9)}…`);
	});

	it('turns a sent message’s references back into chips', () => {
		const sent = compose(['Compare ', task, ' with ', pr]);
		expect(parseRefs(sent)).toEqual([
			'Compare ',
			{ ...task, project: null },
			' with ',
			{ ...pr, project: null }
		]);
		expect(parseRefs('no refs [here]')).toEqual(['no refs [here]']);
	});
});
