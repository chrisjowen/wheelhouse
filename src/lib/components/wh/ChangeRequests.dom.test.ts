import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import type { ChangeRequest, ChangeRequests as Changes } from '$lib/types';
import ChangeRequests from './ChangeRequests.svelte';

const req = (o: Partial<ChangeRequest> = {}): ChangeRequest => ({
	id: 'x',
	source: 'github',
	kind: 'thread',
	author: 'captain',
	text: 'Rename the helper',
	at: '2026-10-27T10:00:00Z',
	url: 'https://github.com/o/r/pull/2#discussion_r1',
	where: { path: 'src/a.ts', line: 7 },
	state: 'open',
	...o
});

let app: ReturnType<typeof mount> | null = null;
afterEach(() => {
	if (app) unmount(app);
	app = null;
	document.body.innerHTML = '';
});
const show = (changes: Changes) => {
	app = mount(ChangeRequests, { target: document.body, props: { changes } });
	flushSync();
};

describe('ChangeRequests', () => {
	it('lists what is still to do with its file, line and GitHub link, and folds the done ones', () => {
		show({
			active: true,
			basis: 'You asked for changes on GitHub after it was reported ready.',
			since: '2026-10-27T10:00:00Z',
			items: [
				req({ id: 'a' }),
				req({
					id: 'b',
					source: 'wheelhouse',
					kind: 'preview',
					author: null,
					url: null,
					where: null,
					text: 'Bigger button',
					state: 'addressed'
				})
			]
		});
		const section = document.querySelector('[data-changes]')!;
		expect(section.getAttribute('data-changes')).toBe('active');
		expect(section.querySelector('h2')!.textContent).toContain('Changes requested');
		expect(section.textContent).toContain('It is the worker’s turn');
		const open = document.querySelectorAll('[data-change="open"]');
		expect(open).toHaveLength(1);
		expect(open[0].textContent).toContain('src/a.ts, line 7');
		expect(open[0].querySelector('a')!.getAttribute('href')).toBe(
			'https://github.com/o/r/pull/2#discussion_r1'
		);
		expect(document.querySelectorAll('[data-change="addressed"]')).toHaveLength(0);
		const toggle = [...document.querySelectorAll('button')].find((b) =>
			b.textContent?.includes('done')
		)!;
		toggle.click();
		flushSync();
		const done = document.querySelector('[data-change="addressed"]')!;
		expect(done.textContent).toContain('Preview feedback');
		expect(done.textContent).toContain('Worker reported it ready since');
	});

	it('keeps the history in view once the work is back with the captain', () => {
		show({ active: false, basis: null, since: null, items: [req({ state: 'resolved' })] });
		expect(document.querySelector('[data-changes]')!.getAttribute('data-changes')).toBe('history');
		expect(document.querySelector('h2')!.textContent).toContain('Requested changes');
		expect(document.querySelector('[data-change="resolved"]')!.textContent).toContain(
			'Resolved on GitHub'
		);
	});
});
