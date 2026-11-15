import { flushSync, mount, tick, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HelperSetting } from '$lib/helperchoice';
import type { ClaudeStatus, DepItem, SetupView } from '$lib/setup';

vi.mock('$app/state', () => ({
	page: {
		data: { sessionToken: 'session-token' },
		url: new URL('http://127.0.0.1:4401/setup?step=claude')
	}
}));
vi.mock('$app/navigation', () => ({ goto: async () => {}, invalidateAll: async () => {} }));
vi.mock('$lib/client/live.svelte', () => ({ live: { onRestart: () => () => {} } }));
vi.mock('$lib/client/plugins', () => ({ afterRestart: async () => {} }));

const { default: Page } = await import('./+page.svelte');

const NOTE =
	'Firstmate is still running in Claude Code. Exit it in its terminal, then start Firstmate to run it in Grok.';

const dep = (tool: string): DepItem => ({
	tool,
	what: tool,
	status: 'ok',
	detail: null,
	required: true,
	oneClick: null,
	terminal: [],
	link: null,
	note: null
});

const signedIn = (tool: string): ClaudeStatus => ({
	installed: true,
	path: `/usr/bin/${tool}`,
	version: '1',
	signedIn: true,
	detail: 'ok',
	install: dep(tool)
});

let finish: { state: string; harness: string; reason: null; attach: null } = {
	state: 'ours',
	harness: 'claude',
	reason: null,
	attach: null
};

function view(
	agent: 'grok' | 'claude',
	running: 'claude' | null,
	helper?: HelperSetting
): SetupView {
	return {
		schema: 'wheelhouse-setup.v1',
		agent: {
			choice: {
				agent,
				auth: 'subscription',
				provider: agent === 'grok' ? 'grok' : 'claude'
			},
			cloud: null,
			answersProblem: null,
			fixed: null,
			helper
		},
		tool: { harness: agent, installed: true },
		platform: { os: 'linux', label: 'Linux', packageManager: null },
		dryRun: true,
		install: { firstmateDir: '/tmp/firstmate', homeDir: '/tmp/firstmate', source: 'remembered' },
		problem: null,
		canChoose: true,
		defaultDir: '/tmp/firstmate',
		found: [],
		repository: 'https://github.com/kunchenguid/firstmate.git',
		git: dep('git'),
		tmux: true,
		canRestart: true,
		runningAgent: running ? { harness: running, state: 'ours' } : null
	};
}

let app: ReturnType<typeof mount> | null = null;
afterEach(() => {
	if (app) unmount(app);
	app = null;
	document.body.innerHTML = '';
	vi.unstubAllGlobals();
});

const settle = async () => {
	for (let i = 0; i < 8; i++) {
		await new Promise((r) => setTimeout(r, 0));
		await tick();
	}
	flushSync();
};

function show(setup: SetupView) {
	vi.stubGlobal(
		'fetch',
		vi.fn(async (_url: string, init?: RequestInit) => {
			const body = init?.body ? (JSON.parse(String(init.body)) as { action?: string }) : {};
			if (body.action === 'agent')
				return Response.json(signedIn(setup.agent?.choice?.agent ?? 'claude'));
			if (body.action === 'finish') return Response.json(finish);
			return Response.json({ dir: '/tmp/firstmate', kind: 'firstmate', message: 'Firstmate' });
		})
	);
	app = mount(Page, { target: document.body, props: { data: { setup } } as never });
	flushSync();
}

const note = () =>
	document.querySelector('[data-agent-switch]')?.textContent?.replace(/\s+/g, ' ').trim();
const button = (label: string) =>
	[...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === label) as
		HTMLButtonElement | undefined;

describe('the setup screen when Firstmate is running in another agent', () => {
	it('says so on the agent step, and how to switch', async () => {
		show(view('grok', 'claude'));
		await settle();
		expect(note()).toBe(NOTE);
		expect(document.body.textContent).not.toContain('Firstmate is starting.');
	});

	it('says so on the last step, and does not report the old session as starting in the new agent', async () => {
		finish = { state: 'ours', harness: 'claude', reason: null, attach: null };
		show(view('grok', 'claude'));
		await settle();
		const step = document.querySelector('[data-step="finish"]') as HTMLButtonElement;
		expect(step.disabled).toBe(false);
		step.click();
		await settle();
		expect(note()).toBe(NOTE);
		expect(document.body.textContent).not.toContain('Firstmate is starting.');
		expect(document.body.textContent).not.toContain('If Grok asks you something first');
		button('Start Firstmate')!.click();
		await settle();
		expect(note()).toBe(NOTE);
		expect(document.body.textContent).not.toContain('Firstmate is starting.');
		expect(document.body.textContent).not.toContain('If Grok asks you something first');
	});

	it('says Firstmate is starting when the session it found is the agent that was chosen', async () => {
		finish = { state: 'starting', harness: 'grok', reason: null, attach: null };
		show(view('grok', null));
		await settle();
		expect(note()).toBeUndefined();
		(document.querySelector('[data-step="finish"]') as HTMLButtonElement).click();
		await settle();
		expect(note()).toBeUndefined();
		expect(document.body.textContent).not.toContain('Firstmate is starting.');
		button('Start Firstmate')!.click();
		await settle();
		expect(note()).toBeUndefined();
		expect(document.body.textContent).toContain('Firstmate is starting.');
		expect(document.body.textContent).toContain('If Grok asks you something first');
	});
});

describe('AI setup', () => {
	it('names the step AI setup and chooses the helper apart from Firstmate’s agent', async () => {
		show(
			view('claude', null, {
				choice: 'grok',
				runs: 'grok',
				fallback: null,
				notice: 'Grok is not signed in, so the helper cannot answer.'
			})
		);
		await settle();
		expect(document.querySelector('#step-title')?.textContent).toContain('AI setup');
		expect(document.querySelector('[data-step="claude"]')?.textContent).toContain('AI setup');
		expect(document.querySelector('[data-helper="grok"]')?.getAttribute('aria-checked')).toBe(
			'true'
		);
		expect(document.querySelector('[data-helper="claude"]')?.getAttribute('aria-checked')).toBe(
			'false'
		);
		expect(document.querySelector('[data-helper="same"]')).toBeNull();
		expect(document.querySelector('[data-helper-notice]')?.textContent).toContain('not signed in');
		expect(document.body.textContent).not.toContain('Same as Firstmate');
		expect(document.body.textContent).toContain('separate');
	});
});
