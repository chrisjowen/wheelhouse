import { flushSync, mount, tick, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PreviewCheck } from '$lib/preview';

vi.mock('$app/state', () => ({ page: { data: {} } }));
const { addressRewrites } = await import('$lib/client/addresses.svelte');
const { previewChecks } = await import('$lib/client/previewchecks.svelte');
const { default: LivePreview } = await import('./LivePreview.svelte');

/** A task's live preview, from a page served at localhost:4310, with and without an address rewrite. */

const CHECK: PreviewCheck = {
	url: 'http://localhost:5173/app',
	reportedAt: null,
	state: 'live',
	reason: null,
	checkedAt: '2026-10-31T00:00:00Z'
};

const STOPPED: PreviewCheck = {
	...CHECK,
	state: 'down',
	reason: 'The worker will bring it back; it shows here again as soon as it answers.'
};

let answer: PreviewCheck = CHECK;
let app: ReturnType<typeof mount> | null = null;
beforeEach(() => {
	(window as unknown as { happyDOM: { setURL(u: string): void } }).happyDOM.setURL(
		'http://localhost:4310/tasks/t-1'
	);
	answer = CHECK;
	vi.stubGlobal(
		'fetch',
		vi.fn(async () => new Response(JSON.stringify(answer), { status: 200 }))
	);
});
afterEach(() => {
	if (app) unmount(app);
	app = null;
	addressRewrites.to = null;
	addressRewrites.hosted = null;
	previewChecks.clear();
	vi.unstubAllGlobals();
	document.body.innerHTML = '';
});

async function shown() {
	app = mount(LivePreview, { target: document.body, props: { taskId: 't-1', feedback: false } });
	await vi.waitFor(() => expect(document.querySelector('iframe')).not.toBeNull());
	flushSync();
	await tick();
	return {
		frame: document.querySelector('iframe')!,
		open: [...document.querySelectorAll('a')].find((a) =>
			a.textContent?.includes('Open in new tab')
		)!,
		label: document.querySelector('span.font-mono')!.textContent
	};
}

describe('LivePreview', () => {
	it('embeds and opens the reported address with no rewrite on', async () => {
		const { frame, open, label } = await shown();
		expect(frame.getAttribute('src')).toBe('http://localhost:5173/app');
		expect(open.getAttribute('href')).toBe('http://localhost:5173/app');
		expect(label).toBe('http://localhost:5173/app');
	});

	it('embeds and opens it at the rewrite’s host while one is on, still naming the reported address', async () => {
		addressRewrites.to = '{port}.localhost';
		const { frame, open, label } = await shown();
		expect(frame.getAttribute('src')).toBe('http://5173.localhost:4310/app');
		expect(open.getAttribute('href')).toBe('http://5173.localhost:4310/app');
		expect(label).toBe('http://localhost:5173/app');
		// Its own origin, apart from Wheelhouse's page, so it keeps its storage and scripts.
		expect(frame.getAttribute('sandbox')).toContain('allow-same-origin');
	});

	it('embeds and opens it at a hosted environment’s URL for its port, before a plugin’s rewrite', async () => {
		addressRewrites.to = '{port}.localhost';
		addressRewrites.hosted = {
			pattern: 'https://cs-{port}.app.github.dev',
			source: 'codespaces',
			reserved: [4310]
		};
		const { frame, open, label } = await shown();
		expect(frame.getAttribute('src')).toBe('https://cs-5173.app.github.dev/app');
		expect(open.getAttribute('href')).toBe('https://cs-5173.app.github.dev/app');
		expect(label).toBe('http://localhost:5173/app');
		expect(frame.getAttribute('sandbox')).toContain('allow-same-origin');
	});

	it('shows a preview that does not answer as stopped, with no link to it, and brings it back once it answers', async () => {
		answer = STOPPED;
		app = mount(LivePreview, { target: document.body, props: { taskId: 't-1' } });
		await vi.waitFor(() => expect(document.body.textContent).toContain('Preview stopped'));
		expect(document.body.textContent).toContain('The worker will bring it back');
		expect(document.querySelector('iframe')).toBeNull();
		expect(document.querySelector('a')).toBeNull();
		expect(document.body.textContent).not.toContain('refused');

		answer = CHECK;
		window.dispatchEvent(new Event('focus'));
		await vi.waitFor(() => expect(document.querySelector('iframe')).not.toBeNull());
		expect(document.querySelector('[data-preview-notice]')).toBeNull();
	});

	it('draws a stopped preview on a card as one short line, not an empty page', async () => {
		answer = STOPPED;
		app = mount(LivePreview, {
			target: document.body,
			props: { taskId: 't-1', compact: true, toolbar: false, onopen: () => {} }
		});
		await vi.waitFor(() => expect(document.body.textContent).toContain('Preview stopped'));
		expect(document.querySelector('.aspect-\\[16\\/10\\]')).toBeNull();
		expect(document.querySelector('[data-preview-open]')).toBeNull();
	});
});
