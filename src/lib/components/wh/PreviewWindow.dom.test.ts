import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The page's data, as each test sets it: live review is the experimental `livereview` feature.
const state = vi.hoisted(() => ({ page: { data: {} as Record<string, unknown> } }));
vi.mock('$app/state', () => state);

const { default: PreviewWindow } = await import('./PreviewWindow.svelte');

let app: ReturnType<typeof mount> | null = null;
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
	// The recorded copy is never reached here: the session says so and stays open.
	vi.stubGlobal(
		'fetch',
		vi.fn(async () => new Response(JSON.stringify({ message: 'No preview.' }), { status: 409 }))
	);
});
afterEach(() => {
	if (app) unmount(app);
	app = null;
	document.body.innerHTML = '';
	vi.unstubAllGlobals();
});

describe('PreviewWindow', () => {
	it('opens a task’s preview as a live review while the switch is on', () => {
		state.page.data = { features: { livereview: true } };
		open();
		expect(document.querySelector('[data-live-review]')).not.toBeNull();
		expect(document.querySelector('[data-preview-studio]')).toBeNull();
	});

	it('opens it full screen as before while the switch is off', () => {
		open();
		expect(document.querySelector('[data-preview-studio]')).not.toBeNull();
		expect(document.querySelector('[data-live-review]')).toBeNull();
	});

	it('keeps landed work, review boards and previews no task reported out of live review', () => {
		state.page.data = { features: { livereview: true } };
		for (const props of [{ talk: false }, { board: true }, { taskId: null }]) {
			open(props);
			expect(document.querySelector('[data-preview-studio]')).not.toBeNull();
			expect(document.querySelector('[data-live-review]')).toBeNull();
			unmount(app!);
			app = null;
			document.body.innerHTML = '';
		}
	});
});
