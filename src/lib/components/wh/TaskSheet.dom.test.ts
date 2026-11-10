import { flushSync, mount, tick, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fleetOf, taskSummary } from '../../../../tests/helpers/task-summary';

const page = vi.hoisted(() => ({
	data: {} as Record<string, unknown>,
	url: new URL('http://127.0.0.1:4310/harbour'),
	state: {} as Record<string, unknown>
}));
vi.mock('$app/state', () => ({ page }));
const nav = vi.hoisted(() => ({ pushState: vi.fn(), replaceState: vi.fn() }));
vi.mock('$app/navigation', () => nav);

const { default: TaskSheet } = await import('./TaskSheet.svelte');

let app: ReturnType<typeof mount> | null = null;
function open(at: string, state: Record<string, unknown> = {}) {
	page.url = new URL(at);
	page.state = state;
	// The browser's own address, which the panel builds on (the page's origin is the test's).
	history.replaceState(null, '', page.url.pathname + page.url.search);
	app = mount(TaskSheet, { target: document.body });
	flushSync();
}
const sheet = () => document.querySelector<HTMLElement>('[data-task-sheet]');
const settle = async () => {
	for (let i = 0; i < 4; i++) {
		await new Promise((r) => setTimeout(r, 0));
		await tick();
	}
	flushSync();
};

beforeEach(() => {
	// Reduced motion: the panel opens and closes without sliding (happy-dom cannot run it).
	vi.stubGlobal('matchMedia', () => ({
		matches: true,
		addEventListener: () => {},
		removeEventListener: () => {}
	}));
	vi.stubGlobal(
		'fetch',
		vi.fn(async () => new Response(JSON.stringify({ message: 'No such task.' }), { status: 404 }))
	);
	page.data = {
		fleet: fleetOf([
			taskSummary('search', 'working', {
				title: 'lumen: Search the docs',
				statusLabel: 'Under way',
				summary: 'Indexing the docs'
			})
		])
	};
});

afterEach(() => {
	if (app) unmount(app);
	app = null;
	document.body.innerHTML = '';
	vi.unstubAllGlobals();
	nav.pushState.mockReset();
	nav.replaceState.mockReset();
});

describe('a task in the side panel', () => {
	it('is closed until the address names a task', () => {
		open('http://127.0.0.1:4310/harbour');
		expect(sheet()).toBeNull();
	});

	it('shows the task over the page, with a way to its full page', () => {
		open('http://127.0.0.1:4310/harbour?task=search');
		const s = sheet()!;
		expect(s.getAttribute('role')).toBe('dialog');
		expect(s.getAttribute('aria-label')).toBe('lumen: Search the docs');
		expect(s.querySelector('h2')?.textContent).toBe('lumen: Search the docs');
		expect(s.textContent).toContain('Indexing the docs');
		const full = s.querySelector<HTMLAnchorElement>('a[data-full-page]')!;
		expect(full.getAttribute('href')).toBe('/tasks/search');
		expect(document.activeElement).toBe(s);
	});

	it('opens the task the page state names, which the address the page loaded with does not', () => {
		open('http://127.0.0.1:4310/harbour', { taskSheet: 'search', taskSheetPushed: true });
		expect(sheet()?.getAttribute('aria-label')).toBe('lumen: Search the docs');
	});

	it('stays closed once closed, though the page loaded with the task in its address', () => {
		open('http://127.0.0.1:4310/harbour?task=search', { taskSheet: null });
		expect(sheet()).toBeNull();
	});

	it('closes on Esc by dropping the task from the address it came with', () => {
		open('http://127.0.0.1:4310/harbour?view=completed&task=search');
		sheet()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		expect(nav.replaceState).toHaveBeenCalledOnce();
		const [url, state] = nav.replaceState.mock.calls[0] as [URL, unknown];
		expect(url.search).toBe('?view=completed');
		expect(state).toEqual({ taskSheet: null });
	});

	it('leaves Esc to a preview or screenshot opened over it', () => {
		open('http://127.0.0.1:4310/harbour?task=search');
		const inner = document.createElement('div');
		inner.setAttribute('role', 'dialog');
		inner.innerHTML = '<button>Close</button>';
		sheet()!.append(inner);
		inner
			.querySelector('button')!
			.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		expect(nav.replaceState).not.toHaveBeenCalled();
	});

	it('goes back when it was opened from the page, so Back and close agree', () => {
		const back = vi.spyOn(history, 'back').mockImplementation(() => {});
		open('http://127.0.0.1:4310/harbour?task=search', {
			taskSheet: 'search',
			taskSheetPushed: true
		});
		document.querySelector<HTMLButtonElement>('button[aria-label="Close (Esc)"]')!.click();
		expect(back).toHaveBeenCalledOnce();
		expect(nav.replaceState).not.toHaveBeenCalled();
		back.mockRestore();
	});

	it('shows what the worker was asked, with a way to the page’s timeline', async () => {
		const NONE = { available: false, reason: 'none' };
		const task = (page.data.fleet as { tasks: unknown[] }).tasks[0];
		vi.stubGlobal(
			'fetch',
			vi.fn(
				async () =>
					new Response(
						JSON.stringify({
							task,
							evidence: {
								files: NONE,
								pr: NONE,
								report: NONE,
								screenshots: NONE,
								preview: NONE,
								decisions: [],
								validation: NONE
							},
							brief: {
								available: true,
								source: 'brief.md',
								observedAt: null,
								value: {
									path: 'data/search/brief.md',
									intent: 'let people search the docs',
									spec: null,
									rest: '',
									bytes: 40,
									truncated: false,
									mate: null,
									remote: false
								}
							},
							timeline: NONE,
							gaps: [],
							time: null,
							decided: [],
							build: { conversation: NONE, checks: NONE, docs: NONE },
							validations: []
						})
					)
			)
		);
		open('http://127.0.0.1:4310/harbour?task=search');
		await settle();
		const brief = sheet()!.querySelector('[data-brief]')!;
		expect(brief.textContent).toContain('let people search the docs');
		expect(brief.querySelector('a')!.getAttribute('href')).toBe('/tasks/search?tab=timeline');
	});

	it('says why when the task cannot be read', async () => {
		open('http://127.0.0.1:4310/?task=gone');
		await settle();
		expect(sheet()?.textContent).toContain('No such task.');
	});
});
