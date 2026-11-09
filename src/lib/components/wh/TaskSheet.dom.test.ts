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

	it('closes on Esc by dropping the task from the address it came with', () => {
		open('http://127.0.0.1:4310/harbour?view=completed&task=search');
		sheet()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		expect(nav.replaceState).toHaveBeenCalledOnce();
		const [url] = nav.replaceState.mock.calls[0] as [URL];
		expect(url.search).toBe('?view=completed');
	});

	it('goes back when it was opened from the page, so Back and close agree', () => {
		const back = vi.spyOn(history, 'back').mockImplementation(() => {});
		open('http://127.0.0.1:4310/harbour?task=search', { taskSheet: true });
		document.querySelector<HTMLButtonElement>('button[aria-label="Close (Esc)"]')!.click();
		expect(back).toHaveBeenCalledOnce();
		expect(nav.replaceState).not.toHaveBeenCalled();
		back.mockRestore();
	});

	it('says why when the task cannot be read', async () => {
		open('http://127.0.0.1:4310/?task=gone');
		await settle();
		expect(sheet()?.textContent).toContain('No such task.');
	});
});
