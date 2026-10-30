import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import type { Attachment } from '$lib/chat/attachments';
import SentFiles from './SentFiles.svelte';

const DIR = '/home/me/.local/state/wheelhouse/uploads/2026-10-31';
const files: Attachment[] = [
	{ path: `${DIR}/0a1b2c3d4e5f/shot.png`, name: 'shot.png', size: 48_354, type: 'image/png' },
	{
		path: `${DIR}/abcdefabcdef/Q3 report.pdf`,
		name: 'Q3 report.pdf',
		size: 326_687,
		type: 'application/pdf'
	},
	{ path: `${DIR}/bbbbbbbbbbbb/logo.svg`, name: 'logo.svg', size: 900, type: 'image/svg+xml' }
];

let app: ReturnType<typeof mount> | null = null;
afterEach(() => {
	if (app) unmount(app);
	app = null;
	document.body.innerHTML = '';
});

describe('SentFiles', () => {
	it('lists each file with its kind and size under an “N files attached” label', () => {
		app = mount(SentFiles, { target: document.body, props: { files } });
		flushSync();
		const card = document.querySelector('[data-sent-files]')!;
		expect(card.textContent).toMatch(/3 files attached/);
		const rows = [...card.querySelectorAll('li')].map((li) =>
			li.textContent?.replace(/\s+/g, ' ').trim()
		);
		expect(rows).toEqual([
			'shot.png Image · 47 KB',
			'Q3 report.pdf PDF · 319 KB',
			'logo.svg Image · 900 B'
		]);
	});

	it('shows a thumbnail only for a raster image, from Wheelhouse’s uploads route', () => {
		app = mount(SentFiles, { target: document.body, props: { files } });
		flushSync();
		const imgs = [...document.querySelectorAll('img')].map((i) => i.getAttribute('src'));
		expect(imgs).toEqual(['/api/firstmate/uploads/2026-10-31/0a1b2c3d4e5f/shot.png']);
	});

	it('falls back to the file icon when a thumbnail cannot load (the file was cleaned up)', () => {
		app = mount(SentFiles, { target: document.body, props: { files: [files[0]] } });
		flushSync();
		document.querySelector('img')!.dispatchEvent(new Event('error'));
		flushSync();
		expect(document.querySelector('img')).toBeNull();
		expect(document.querySelector('[data-sent-files]')?.textContent).toMatch(/1 file attached/);
	});
});
