import { flushSync, mount, tick, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PreviewCheck } from '$lib/preview';

// Whether the screen is phone-sized, as each test sets it.
const media = vi.hoisted(() => ({ current: true }));
vi.mock('$lib/client/phone.svelte', () => ({ phone: media }));
const state = vi.hoisted(() => ({
	page: { data: { sessionToken: 'tok' } as Record<string, unknown> }
}));
vi.mock('$app/state', () => state);
const { previewChecks } = await import('$lib/client/previewchecks.svelte');
const { default: PreviewStudio } = await import('./PreviewStudio.svelte');

/** A task's live preview full screen, on a phone and from `md` up. */

const ADDRESS = 'http://localhost:5173/app';
const CHECK: PreviewCheck = {
	url: ADDRESS,
	reportedAt: null,
	state: 'live',
	reason: null,
	checkedAt: '2026-11-11T00:00:00Z'
};

let app: ReturnType<typeof mount> | null = null;
beforeEach(() => {
	(window as unknown as { happyDOM: { setURL(u: string): void } }).happyDOM.setURL(
		'http://localhost:4310/tasks/t-1'
	);
	vi.stubGlobal(
		'fetch',
		vi.fn(async () => new Response(JSON.stringify(CHECK), { status: 200 }))
	);
	// Reduced motion: it opens and closes without its zoom (happy-dom cannot run it).
	vi.stubGlobal('matchMedia', () => ({
		matches: true,
		addEventListener: () => {},
		removeEventListener: () => {}
	}));
});
afterEach(() => {
	if (app) unmount(app);
	app = null;
	previewChecks.clear();
	vi.unstubAllGlobals();
	document.body.innerHTML = '';
	media.current = true;
	state.page.data = { sessionToken: 'tok' };
});

async function studio(onclose = () => {}) {
	app = mount(PreviewStudio, {
		target: document.body,
		props: { taskId: 't-1', title: 'Share links', url: ADDRESS, onclose }
	});
	await vi.waitFor(() => expect(document.querySelector('iframe')).not.toBeNull());
	flushSync();
	await tick();
}

const dock = () => document.querySelector<HTMLElement>('[data-preview-dock]')!;
const button = (label: string) =>
	document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;

describe('the full-screen preview on a phone', () => {
	it('fills the screen under Close, the title and the address, with the page’s own row left out', async () => {
		const onclose = vi.fn();
		await studio(onclose);
		const bar = document.querySelector<HTMLElement>('[data-preview-phone-bar]')!;
		expect(bar.textContent).toContain('Share links');
		expect(bar.textContent).toContain('localhost:5173');
		// The embedded page's own address row (Open in new tab, Full screen) is not drawn.
		expect(document.body.textContent).not.toContain('Open in new tab');
		bar.querySelector<HTMLButtonElement>('button[aria-label="Close full screen"]')!.click();
		expect(onclose).toHaveBeenCalledOnce();
	});

	it('keeps the helper closed until Talk, and the dock switches to a desktop’s width', async () => {
		await studio();
		expect(document.querySelector('[data-preview-helper-panel]')).toBeNull();
		const open = dock().querySelector<HTMLAnchorElement>('a[aria-label="Open in a new tab"]')!;
		expect(open.href).toBe(ADDRESS);

		const width = button('Show at a desktop’s width');
		width.click();
		flushSync();
		expect(width.getAttribute('aria-pressed')).toBe('true');
		expect(width.getAttribute('aria-label')).toBe('Show at the phone’s width');

		button('Talk it through').click();
		flushSync();
		expect(document.querySelector('[data-preview-helper-panel]')).not.toBeNull();
		// The dock's Talk gives way to the open helper, which closes from its own row.
		expect(dock().querySelector('button[aria-label="Talk it through"]')).toBeNull();
		button('Hide the helper').click();
		flushSync();
		expect(document.querySelector('[data-preview-helper-panel]')).toBeNull();
	});
});

describe('the full-screen preview from md up', () => {
	it('opens with the helper beside the page and the page’s own address row', async () => {
		media.current = false;
		await studio();
		expect(document.querySelector('[data-preview-helper-panel]')).not.toBeNull();
		expect(document.body.textContent).toContain('Open in new tab');
	});
});

describe('the full-screen preview while a plugin is the review surface', () => {
	it('leaves the helper out on a desktop and a phone, and brings it back with the built-in', async () => {
		media.current = false;
		state.page.data = { sessionToken: 'tok', reviewSurface: { id: 'hr', name: 'Human Review' } };
		await studio();
		expect(document.querySelector('[data-preview-helper-panel]')).toBeNull();
		expect(document.body.textContent).not.toContain('Talk it through');
		expect(document.body.textContent).not.toContain('Hide the helper');
		// The surface's own button takes the helper's place on the top bar.
		expect(document.querySelector('[data-preview-surface]')).not.toBeNull();
		if (app) unmount(app);

		media.current = true;
		await studio();
		expect(button('Talk it through')).toBeNull();
		if (app) unmount(app);

		media.current = false;
		state.page.data = { sessionToken: 'tok', reviewSurface: null };
		await studio();
		expect(document.querySelector('[data-preview-helper-panel]')).not.toBeNull();
		expect(document.querySelector('[data-preview-surface]')).toBeNull();
	});
});
