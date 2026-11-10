import { describe, expect, it } from 'vitest';
import {
	canFinish,
	canOpen,
	claudeFact,
	firstOpenStep,
	nextStep,
	NO_FACTS,
	stepStates,
	toolsFact,
	type ClaudeStatus,
	type DepItem,
	type SetupFacts,
	type ToolsReport
} from './setup';

const ready: SetupFacts = {
	home: true,
	tools: 'ok',
	claude: 'ok',
	check: 'ok',
	plugins: 'seen',
	tmux: true
};

describe('the setup steps', () => {
	it('start at the location, with everything after it locked', () => {
		const s = stepStates(NO_FACTS);
		expect(s.location).toBe('todo');
		expect([s.tools, s.claude, s.check, s.plugins, s.finish]).toEqual(Array(5).fill('locked'));
		expect(firstOpenStep(NO_FACTS)).toBe('location');
		expect(canOpen('tools', NO_FACTS)).toBe(false);
		expect(nextStep('location', NO_FACTS)).toBe('location');
	});

	it('open once there is a home, each to do until it has looked', () => {
		const f = { ...NO_FACTS, home: true, tmux: true };
		const s = stepStates(f);
		expect(s.location).toBe('done');
		expect([s.tools, s.claude, s.check, s.plugins]).toEqual(Array(4).fill('todo'));
		expect(firstOpenStep(f)).toBe('tools');
		expect(nextStep('location', f)).toBe('tools');
		expect(nextStep('plugins', f)).toBe('plugins');
	});

	it('mark what needs fixing without locking the way on', () => {
		const f: SetupFacts = { ...ready, tools: 'missing', check: 'problems' };
		const s = stepStates(f);
		expect(s.tools).toBe('attention');
		expect(s.check).toBe('attention');
		expect(nextStep('tools', f)).toBe('claude');
		expect(firstOpenStep(f)).toBe('tools');
	});

	it('only finish once Claude Code answers and tmux is here', () => {
		expect(canFinish(ready)).toEqual({ ok: true });
		expect(stepStates(ready).finish).toBe('todo');
		expect(canFinish({ ...ready, home: false })).toMatchObject({ ok: false });
		expect(canFinish({ ...ready, tmux: false })).toMatchObject({
			why: expect.stringMatching(/tmux/)
		});
		expect(canFinish({ ...ready, claude: 'missing' })).toMatchObject({
			why: expect.stringMatching(/Install/)
		});
		expect(canFinish({ ...ready, claude: 'signed-out' })).toMatchObject({
			why: expect.stringMatching(/Sign in/)
		});
		expect(stepStates({ ...ready, claude: 'signed-out' }).finish).toBe('locked');
		// Missing optional tools never hold Firstmate back.
		expect(canFinish({ ...ready, tools: 'missing' })).toEqual({ ok: true });
		expect(nextStep('plugins', ready)).toBe('finish');
	});
});

const item = (tool: string, status: DepItem['status'], required = true): DepItem => ({
	tool,
	what: '',
	status,
	detail: null,
	required,
	oneClick: null,
	terminal: [],
	link: null,
	note: null
});
const report = (items: DepItem[], error: string | null = null): ToolsReport => ({
	backend: 'tmux',
	items,
	notes: [],
	error,
	checkedAt: ''
});

describe('facts from what the server said', () => {
	it('tools are ok only when every required one is', () => {
		expect(toolsFact(null)).toBe('unknown');
		expect(toolsFact(report([], 'no bash'))).toBe('unknown');
		expect(toolsFact(report([item('git', 'ok'), item('lavish-axi', 'optional', false)]))).toBe(
			'ok'
		);
		expect(toolsFact(report([item('git', 'ok'), item('gh', 'needs-auth')]))).toBe('missing');
	});

	it('claude is ok only once its test passed', () => {
		const c = (o: Partial<ClaudeStatus>): ClaudeStatus => ({
			installed: true,
			path: '/bin/claude',
			version: '2.0.0',
			signedIn: null,
			detail: null,
			install: item('claude', 'ok'),
			...o
		});
		expect(claudeFact(null)).toBe('unknown');
		expect(claudeFact(c({ installed: false }))).toBe('missing');
		expect(claudeFact(c({}))).toBe('unknown');
		expect(claudeFact(c({ signedIn: false }))).toBe('signed-out');
		expect(claudeFact(c({ signedIn: true }))).toBe('ok');
	});
});
