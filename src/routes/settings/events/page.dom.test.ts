import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import type { EventsView } from '$lib/events';

vi.mock('$app/state', () => ({
	page: {
		data: { sessionToken: 'test-session', features: { events: true, remotes: false } },
		url: new URL('http://127.0.0.1:4310/settings/events')
	}
}));

const { default: Page } = await import('./+page.svelte');

const view = {
	schema: 'wh-events-store.v1',
	settings: {
		paused: false,
		timeZone: 'UTC',
		quiet: { enabled: false, start: '22:00', end: '08:00' },
		rules: [],
		source: { level: 'notify-only', paused: false, reason: null }
	},
	reminders: [],
	events: [],
	batches: [],
	delivery: null,
	counters: { dropped: 0, limited: 0 },
	sourceWindows: [],
	resumeNotice: false,
	problem: null,
	connected: false,
	bound: false,
	pending: 0,
	connectionProblem: null
} as unknown as EventsView;

let app: ReturnType<typeof mount> | null = null;
afterEach(() => {
	if (app) unmount(app);
	app = null;
	document.body.innerHTML = '';
	vi.unstubAllGlobals();
});

describe('Settings → Events', () => {
	it('keeps the Feed, Rules and Sources reachable from the Settings row', () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(() => Promise.resolve({ ok: true, json: async () => view }))
		);
		app = mount(Page, { target: document.body, props: { data: { events: view } } as never });
		flushSync();

		expect(document.querySelector('a[href="/settings/events"]')?.getAttribute('aria-current')).toBe(
			'page'
		);
		expect(document.querySelector('nav[aria-label="Events pages"]')).toBeTruthy();
		expect(document.body.textContent).toContain('Feed');
		expect(document.body.textContent).toContain('Rules');
		expect(document.body.textContent).toContain('Sources');
	});
});
