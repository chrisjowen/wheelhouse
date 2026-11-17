import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The page's data, as each test sets it: live review is the experimental `livereview` feature.
const state = vi.hoisted(() => ({ page: { data: {} as Record<string, unknown> } }));
vi.mock('$app/state', () => state);

const { default: PreviewWindow } = await import('./PreviewWindow.svelte');

let app: ReturnType<typeof mount> | null = null;
let assign: ReturnType<typeof vi.fn<(url: string | URL) => void>>;
let tabs: { opener: unknown }[];
let blocked = false;
const open = (props: Record<string, unknown> = {}) => {
	app = mount(PreviewWindow, {
		target: document.body,
		props: {
			taskId: 'lumen-share-links',
			title: 'Share links',
			url: 'http://127.0.0.1:5240/',
			onclose: () => {},
			...props
		}
	});
	flushSync();
};

beforeEach(() => {
	state.page.data = {};
	history.replaceState(null, '', '/?thread=lumen');
	assign = vi.fn<(url: string | URL) => void>();
	vi.spyOn(window.location, 'assign').mockImplementation(assign);
	tabs = [];
	blocked = false;
	vi.spyOn(window, 'open').mockImplementation((url, target) => {
		if (blocked) return null;
		const tab = { url, target, opener: window as unknown };
		tabs.push(tab);
		return tab as unknown as Window;
	});
	vi.stubGlobal(
		'fetch',
		vi.fn(async () => new Response('{}', { status: 200 }))
	);
});
afterEach(() => {
	if (app) unmount(app);
	app = null;
	document.body.innerHTML = '';
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('PreviewWindow', () => {
	it('opens a task’s preview as the page itself, for review, in a new tab while the switch is on', () => {
		state.page.data = { features: { livereview: true } };
		const onclose = vi.fn();
		open({ onclose });
		expect(window.open).toHaveBeenCalledWith(
			'/tasks/lumen-share-links/live?back=%2F%3Fthread%3Dlumen',
			'_blank'
		);
		// The previewed page gets no hold on Wheelhouse's tab, which stays where it was.
		expect(tabs[0].opener).toBeNull();
		expect(assign).not.toHaveBeenCalled();
		expect(document.querySelector('[data-preview-studio]')).toBeNull();
		expect(onclose).toHaveBeenCalled();
	});

	it('opens it in this tab when the browser blocks a new one', () => {
		state.page.data = { features: { livereview: true } };
		blocked = true;
		open();
		expect(assign).toHaveBeenCalledWith('/tasks/lumen-share-links/live?back=%2F%3Fthread%3Dlumen');
	});

	it('opens it full screen with the helper as before while the switch is off', () => {
		open();
		expect(assign).not.toHaveBeenCalled();
		expect(document.querySelector('[data-preview-studio]')).not.toBeNull();
	});

	it('keeps landed work, review boards and previews no task reported as they were', () => {
		state.page.data = { features: { livereview: true } };
		for (const props of [{ talk: false }, { board: true }, { taskId: null }]) {
			open(props);
			expect(document.querySelector('[data-preview-studio]')).not.toBeNull();
			unmount(app!);
			app = null;
			document.body.innerHTML = '';
		}
		expect(assign).not.toHaveBeenCalled();
		expect(window.open).not.toHaveBeenCalled();
	});
});
