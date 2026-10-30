import { flushSync, mount, tick, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PreviewCheck } from '$lib/preview';

vi.mock('$app/state', () => ({ page: { data: {} } }));
const { localProxy } = await import('$lib/client/localproxy.svelte');
const { default: LivePreview } = await import('./LivePreview.svelte');

/** A task's live preview, from a page served at localhost:4310, with the localhost proxy on and off. */

const CHECK: PreviewCheck = {
	url: 'http://localhost:5173/app',
	reportedAt: null,
	state: 'live',
	reason: null,
	checkedAt: '2026-10-31T00:00:00Z'
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
});
afterEach(() => {
	if (app) unmount(app);
	app = null;
	localProxy.on = false;
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
	it('embeds and opens the reported address while the proxy is off', async () => {
		const { frame, open, label } = await shown();
		expect(frame.getAttribute('src')).toBe('http://localhost:5173/app');
		expect(open.getAttribute('href')).toBe('http://localhost:5173/app');
		expect(label).toBe('http://localhost:5173/app');
	});

	it('embeds and opens it through Wheelhouse while the proxy is on, still naming the reported address', async () => {
		localProxy.on = true;
		const { frame, open, label } = await shown();
		expect(frame.getAttribute('src')).toBe('http://5173.localhost:4310/app');
		expect(open.getAttribute('href')).toBe('http://5173.localhost:4310/app');
		expect(label).toBe('http://localhost:5173/app');
		// Its own origin, apart from Wheelhouse's page, so it keeps its storage and scripts.
		expect(frame.getAttribute('sandbox')).toContain('allow-same-origin');
	});
});
