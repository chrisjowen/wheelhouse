import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import type { Notice } from '$lib/notices';
import NoticeStrip from './NoticeStrip.svelte';

let app: ReturnType<typeof mount> | null = null;
afterEach(() => {
	if (app) unmount(app);
	app = null;
	document.body.innerHTML = '';
});

const LOST: Notice = {
	key: 'connection',
	tone: 'danger',
	title: 'Connection trouble',
	text: 'Can’t reach the Wheelhouse server, retrying.'
};
const STALE: Notice = {
	key: 'stale',
	tone: 'warning',
	title: 'Updates may be late',
	text: 'Fleet view last updated 1 h ago.'
};

describe('the notice strip', () => {
	it('is one line, closed at first, that opens and closes on a tap', () => {
		const props = $state({ items: [LOST, STALE] });
		app = mount(NoticeStrip, { target: document.body, props });
		flushSync();
		const row = document.querySelector<HTMLButtonElement>('[data-notice-strip] button')!;
		const panel = document.getElementById('wh-notices')!;
		expect(row.textContent).toContain('Connection trouble · 2 issues');
		expect(row.getAttribute('aria-expanded')).toBe('false');
		expect(panel.hidden).toBe(true);
		expect(panel.querySelectorAll('li')).toHaveLength(2);

		row.click();
		flushSync();
		expect(row.getAttribute('aria-expanded')).toBe('true');
		expect(panel.hidden).toBe(false);
		expect(panel.textContent).toContain('Fleet view last updated 1 h ago.');

		row.click();
		flushSync();
		expect(panel.hidden).toBe(true);
	});

	it('goes away once everything clears, and comes back closed', () => {
		const props = $state<{ items: Notice[] }>({ items: [STALE] });
		app = mount(NoticeStrip, { target: document.body, props });
		flushSync();
		document.querySelector<HTMLButtonElement>('[data-notice-strip] button')!.click();
		flushSync();

		props.items = [];
		flushSync();
		expect(document.querySelector('[data-notice-strip]')).toBeNull();

		props.items = [STALE];
		flushSync();
		const row = document.querySelector<HTMLButtonElement>('[data-notice-strip] button')!;
		expect(row.textContent).toContain('Updates may be late');
		expect(row.getAttribute('aria-expanded')).toBe('false');
	});
});
