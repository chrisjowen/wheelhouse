import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppOpenView } from '$lib/apps/types';
import ChatApp from './ChatApp.svelte';

vi.mock('$app/state', () => ({
	page: { data: { sessionToken: 'tok', health: { version: '1.2.3' } } }
}));

const ready: AppOpenView = {
	schema: 'wheelhouse-app.v1',
	state: 'ready',
	server: { id: 'docket', title: 'Docket' },
	tool: { name: 'docket_search' },
	html: '<!doctype html><p>graph</p>',
	csp: {},
	prefersBorder: true,
	input: { query: 'billing' },
	sandbox: 'http://127.0.0.1:5999/sandbox.html?csp=%7B%7D&sig=signed'
};

let calls: { url: string; body: Record<string, unknown> }[];

beforeEach(() => {
	calls = [];
	vi.stubGlobal(
		'fetch',
		vi.fn(async (url: string, init: RequestInit) => {
			calls.push({ url, body: JSON.parse(String(init.body ?? '{}')) });
			return new Response(JSON.stringify(ready), { status: 200 });
		})
	);
});
afterEach(() => {
	document.body.innerHTML = '';
	vi.unstubAllGlobals();
});

const settle = async () => {
	for (let i = 0; i < 5; i++) {
		await new Promise((r) => setTimeout(r, 0));
		flushSync();
	}
};

describe('an MCP app in the chat', () => {
	it('is a closed card until the captain opens it, then draws the app for that tool call', async () => {
		const c = mount(ChatApp, {
			target: document.body,
			props: {
				id: 'toolu_1',
				app: { plugin: 'docket', server: { id: 'docket', title: 'Docket' }, title: 'Search' }
			}
		});
		await settle();
		const button = document.querySelector<HTMLButtonElement>('[data-chat-app] button')!;
		expect(button.textContent).toContain('Search');
		expect(button.textContent).toContain('an app from Docket');
		expect(button.getAttribute('aria-expanded')).toBe('false');
		expect(document.querySelector('iframe')).toBeNull();
		expect(calls).toEqual([]);

		button.click();
		await settle();
		expect(button.getAttribute('aria-expanded')).toBe('true');
		expect(calls[0]).toEqual({ url: '/api/apps/open', body: { chat: 'toolu_1' } });
		const frame = document.querySelector('iframe')!;
		expect(new URL(frame.src).origin).toBe('http://127.0.0.1:5999');
		expect(frame.title).toBe('Search: an app from Docket');
		expect(document.querySelector('[data-app]')?.getAttribute('data-app')).toBe('chat/toolu_1');

		// Closing it takes the app down.
		button.click();
		await settle();
		expect(document.querySelector('iframe')).toBeNull();
		unmount(c);
	});
});
