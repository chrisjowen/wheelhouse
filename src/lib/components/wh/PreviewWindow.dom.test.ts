import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The page's data, as each test sets it: live review is the experimental `livereview` feature.
const state = vi.hoisted(() => ({ page: { data: {} as Record<string, unknown> } }));
vi.mock('$app/state', () => state);

const { default: PreviewWindow } = await import('./PreviewWindow.svelte');

let app: ReturnType<typeof mount> | null = null;
let assign: ReturnType<typeof vi.fn<(url: string | URL) => void>>;
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
	it('opens a task’s preview as the page itself, for review, while the switch is on', () => {
		state.page.data = { features: { livereview: true } };
		const onclose = vi.fn();
		open({ onclose });
		expect(assign).toHaveBeenCalledWith('/tasks/lumen-share-links/live?back=%2F%3Fthread%3Dlumen');
		expect(document.querySelector('[data-preview-studio]')).toBeNull();
		// Coming back with the browser's Back button finds the page as it was.
		expect(onclose).toHaveBeenCalled();
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
	});
});
