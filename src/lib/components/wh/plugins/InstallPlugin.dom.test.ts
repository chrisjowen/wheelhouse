import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import InstallPlugin from './InstallPlugin.svelte';

afterEach(() => {
	document.body.innerHTML = '';
	vi.unstubAllGlobals();
});

const improve = {
	id: 'improve',
	name: 'Improve',
	repository: 'chrisjowen/improve',
	reason: 'This Firstmate home uses improve.',
	command: 'wheelhouse plugin install chrisjowen/improve'
};

describe('the install card for a plugin the home uses', () => {
	it('says why and gives the exact command, to copy', async () => {
		const writeText = vi.fn(async () => {});
		vi.stubGlobal('navigator', { clipboard: { writeText } });
		const c = mount(InstallPlugin, { target: document.body, props: { plugin: improve } });
		flushSync();
		expect(document.querySelector('h2')?.textContent).toBe('Install the improve plugin');
		expect(document.body.textContent).toContain('This Firstmate home uses improve.');
		expect(document.querySelector('code')?.textContent).toBe(
			'wheelhouse plugin install chrisjowen/improve'
		);
		document.querySelector('button')!.click();
		await new Promise((r) => setTimeout(r, 0));
		flushSync();
		expect(writeText).toHaveBeenCalledWith('wheelhouse plugin install chrisjowen/improve');
		expect(document.querySelector('button')?.textContent).toBe('Copied');
		unmount(c);
	});
});
