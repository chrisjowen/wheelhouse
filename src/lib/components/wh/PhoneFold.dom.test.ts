import { createRawSnippet, flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { Timer } from '@lucide/svelte';
import PhoneFold from './PhoneFold.svelte';

let app: ReturnType<typeof mount> | null = null;
afterEach(() => {
	if (app) unmount(app);
	app = null;
	document.body.innerHTML = '';
});

describe('a part of a page folded away on a phone', () => {
	it('opens from its row and is only ever hidden below md', () => {
		app = mount(PhoneFold, {
			target: document.body,
			props: {
				id: 'overview-time',
				title: 'Where its time went',
				hint: '2h 42m',
				icon: Timer,
				children: createRawSnippet(() => ({ render: () => '<p data-held>The time</p>' }))
			}
		});
		flushSync();
		const row = document.querySelector<HTMLButtonElement>('[data-phone-fold]')!;
		const held = document.getElementById('overview-time')!;
		// The row is a phone's only; wide screens show what it holds as before.
		expect(row.className).toContain('md:hidden');
		expect(row.textContent).toContain('Where its time went · 2h 42m');
		expect(row.getAttribute('aria-controls')).toBe('overview-time');
		expect(row.getAttribute('aria-expanded')).toBe('false');
		expect(held.className).toBe('max-md:hidden');
		expect(held.querySelector('[data-held]')).not.toBeNull();

		row.click();
		flushSync();
		expect(row.getAttribute('aria-expanded')).toBe('true');
		expect(held.className).not.toContain('hidden');
	});
});
