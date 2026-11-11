import { flushSync, mount, tick, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Whether the screen is phone-sized, as each test sets it.
const media = vi.hoisted(() => ({ current: true }));
vi.mock('$lib/client/phone.svelte', () => ({ phone: media }));
const { default: ThreadTag } = await import('./ThreadTag.svelte');

/** A message's thread tag: its threads in a sheet on a phone, a popover from `md` up. */

const threads = [
	{ topic: 'lumen', name: 'lumen', hue: 1 },
	{ topic: 'atlas', name: 'atlas', hue: 2 }
];

let app: ReturnType<typeof mount> | null = null;
afterEach(() => {
	if (app) unmount(app);
	app = null;
	document.body.innerHTML = '';
	media.current = true;
});

async function tag(onMove = vi.fn()) {
	app = mount(ThreadTag, {
		target: document.body,
		props: { tag: { topic: 'lumen', source: 'guess' }, threads, onMove }
	});
	flushSync();
	document.querySelector<HTMLButtonElement>('.thread-tag')!.click();
	flushSync();
	await tick();
	return onMove;
}

describe('a thread tag', () => {
	it('opens its threads in a sheet on a phone, and a pick moves the message', async () => {
		const onMove = await tag();
		const sheet = document.querySelector<HTMLElement>('[data-sheet]')!;
		expect(sheet.getAttribute('role')).toBe('dialog');
		expect(sheet.textContent).toContain('Move to thread');
		[...sheet.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'atlas')!.click();
		flushSync();
		expect(onMove).toHaveBeenCalledWith('atlas');
		await vi.waitFor(() => expect(document.querySelector('[data-sheet]')).toBeNull());
	});

	it('opens a popover, not a sheet, from md up', async () => {
		media.current = false;
		await tag();
		expect(document.querySelector('[data-sheet]')).toBeNull();
		await vi.waitFor(() =>
			expect(document.querySelector('input[aria-label="New topic"]')).not.toBeNull()
		);
	});
});
