import { describe, expect, it } from 'vitest';
import { handoffBody, handoffPrefill, sessionLabel } from './sessions';
import type { SessionSummary } from './types';

const session = (over: Partial<SessionSummary> = {}): SessionSummary => ({
	id: '20261011-140509-abcd',
	tmux: 'wh-session-20261011-140509-abcd',
	project: { id: 'wheelhouse', name: 'wheelhouse', path: '/work/wheelhouse' },
	prompt: null,
	createdAt: '2026-10-11T14:05:09.000Z',
	dir: '/state/sessions/20261011-140509-abcd',
	state: 'alive',
	attach: 'tmux attach-session -t =wh-session-20261011-140509-abcd',
	...over
});

describe('hand-off to Firstmate', () => {
	it('prefills Re: session, the scratch directory and what it is about', () => {
		expect(handoffPrefill(session())).toBe(
			'Re: session 20261011-140509-abcd\nSession notes: /state/sessions/20261011-140509-abcd\nProject: wheelhouse\n\n'
		);
		expect(handoffPrefill(session({ project: null }))).toContain('\nBlank idea\n');
	});

	it('sends what the captain wrote under the prefilled header', () => {
		const s = session();
		expect(handoffBody(`${handoffPrefill(s)}Make this a task.\n`, s)).toBe(
			'Re: session 20261011-140509-abcd\nSession notes: /state/sessions/20261011-140509-abcd\nProject: wheelhouse\n\nMake this a task.'
		);
	});

	it('puts the Re: line and the scratch directory back if they were edited away', () => {
		const s = session();
		const body = handoffBody('Make this a task.', s);
		expect(body.split('\n')).toEqual([
			'Re: session 20261011-140509-abcd',
			'Session notes: /state/sessions/20261011-140509-abcd',
			'Make this a task.'
		]);
		expect(handoffBody('Re: session 20261011-140509-abcd\nhi', s).split('\n')).toEqual([
			'Re: session 20261011-140509-abcd',
			'Session notes: /state/sessions/20261011-140509-abcd',
			'hi'
		]);
	});

	it('labels a session by its project, or as a blank idea', () => {
		expect(sessionLabel(session())).toBe('wheelhouse');
		expect(sessionLabel(session({ project: null }))).toBe('Blank idea');
	});
});
