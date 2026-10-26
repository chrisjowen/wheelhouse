import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { alertsFor, raiseKey } from '$lib/bell';
import type { ShipAlert, TaskSummary } from '$lib/types';
import { fleetOf, prGreen, question, taskSummary } from '../../../../../tests/helpers/task-summary';

vi.mock('$app/state', () => ({ page: { data: { sessionToken: 'tok' } } }));
const goto = vi.fn(async () => {});
vi.mock('$app/navigation', () => ({ goto }));

const { bell } = await import('$lib/client/bell.svelte');
const { live } = await import('$lib/client/live.svelte');
const { default: Toasts } = await import('./Toasts.svelte');

const NOW = Date.parse('2026-10-27T10:00:00Z');
const alertOf = (t: TaskSummary): ShipAlert => ({
	...alertsFor(t, NOW)[0],
	at: new Date(NOW).toISOString()
});
const ring = (a: ShipAlert, fresh = true) => {
	bell.receive({ type: 'alert', data: a, fresh });
	flushSync();
};
const toastTitles = () => bell.toasts.map((t) => t.alert.title);
const button = (label: string) =>
	[...document.querySelectorAll<HTMLElement>('button, a')].find(
		(b) => b.textContent?.trim() === label || b.getAttribute('aria-label') === label
	);

let app: ReturnType<typeof mount>;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
	localStorage.clear();
	live.fleet = null;
	fetchMock = vi.fn(
		async () => new Response(JSON.stringify({ replay: false, message: {} }), { status: 201 })
	);
	vi.stubGlobal('fetch', fetchMock);
	// Reduced motion: toasts come and go without animating (happy-dom cannot run them).
	vi.stubGlobal('matchMedia', () => ({
		matches: true,
		addEventListener: () => {},
		removeEventListener: () => {}
	}));
	document.body.innerHTML = '';
	app = mount(Toasts, { target: document.body });
	flushSync();
});

afterEach(() => {
	unmount(app);
	bell.toasts = [];
	bell.log = [];
	bell.unread = 0;
	bell.notes = {};
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

describe('ship’s bell toasts', () => {
	it('shows a green PR with Merge, sending the captain note to Firstmate once', async () => {
		const a = alertOf(prGreen('share-links'));
		ring(a);
		expect(document.body.textContent).toContain('share-links');
		expect(document.body.textContent).toContain('Pull request #42 is green and ready to merge.');
		expect(bell.unread).toBe(1);

		button('Merge')!.click();
		await vi.waitFor(() =>
			expect(bell.notes[(a.actions[0] as { requestId: string }).requestId]).toEqual({
				state: 'sent'
			})
		);
		flushSync();
		expect(fetchMock).toHaveBeenCalledTimes(1);
		const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(url).toBe('/api/firstmate/messages');
		const headers = init.headers as Record<string, string>;
		expect(headers['idempotency-key']).toMatch(/^wh-bell-merge-/);
		expect(headers['x-wheelhouse-session']).toBe('tok');
		expect(JSON.parse(init.body as string)).toEqual({
			text: expect.stringContaining('Please merge https://github.com/example/lumen/pull/42'),
			taskId: null
		});
		expect(document.body.textContent).toContain('Asked Firstmate to merge');
		// Once sent, another tap does nothing.
		await bell.act(a.actions[0], 'tok');
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('keeps a captain’s toast until it is dismissed, and never shows it again', () => {
		vi.useFakeTimers();
		const a = alertOf(question('upload'));
		ring(a);
		vi.advanceTimersByTime(60_000);
		expect(toastTitles()).toEqual(['upload']);
		button('Dismiss')!.click();
		flushSync();
		expect(toastTitles()).toEqual([]);
		expect(JSON.parse(localStorage.getItem('wheelhouse-bell-dismissed')!)).toEqual([raiseKey(a)]);
		ring(a, false);
		ring(a, true);
		expect(toastTitles()).toEqual([]);
		// Asked again later: a new raise, so it shows again.
		ring({ ...a, at: new Date(NOW + 60_000).toISOString() });
		expect(toastTitles()).toEqual(['upload']);
	});

	it('lets news close itself', () => {
		vi.useFakeTimers();
		ring(alertOf(taskSummary('m', 'landed')));
		expect(toastTitles()).toEqual(['m']);
		vi.advanceTimersByTime(10_000);
		expect(toastTitles()).toEqual([]);
	});

	it('shows old news quietly only when it still waits on the captain', () => {
		ring(alertOf(taskSummary('m', 'landed')), false);
		ring(alertOf(question('q')), false);
		expect(toastTitles()).toEqual(['q']);
		expect(bell.unread).toBe(0);
		expect(bell.log.map((a) => a.title).sort()).toEqual(['m', 'q']);
	});

	it('drops a captain’s toast once its moment has passed', () => {
		ring(alertOf(prGreen('p')));
		live.fleet = fleetOf([prGreen('p')]);
		flushSync();
		expect(toastTitles()).toEqual(['p']);
		live.fleet = fleetOf([taskSummary('p', 'landed')]);
		flushSync();
		expect(toastTitles()).toEqual([]);
	});

	it('drops a session question once the server says it was answered', () => {
		const q: ShipAlert = {
			id: 'question:firstmate:abc',
			kind: 'question',
			taskId: null,
			projectId: null,
			title: 'Firstmate',
			text: 'Which onboarding design should ship?',
			at: new Date(NOW).toISOString(),
			captain: true,
			actions: [{ kind: 'open', label: 'Answer in chat', href: '/', external: false }]
		};
		ring(q);
		live.fleet = fleetOf([]);
		flushSync();
		expect(toastTitles()).toEqual(['Firstmate']);
		bell.receive({ type: 'settled', data: q.id });
		flushSync();
		expect(toastTitles()).toEqual([]);
	});

	it('shows the newest three and folds the rest into “+N more”', () => {
		for (const id of ['a', 'b', 'c', 'd', 'e']) ring(alertOf(question(id)));
		const titles = () =>
			[...document.querySelectorAll('[role="alert"] .font-display')].map((e) => e.textContent);
		expect(titles()).toEqual(['e', 'd', 'c']);
		button('+2 more')!.click();
		flushSync();
		expect(titles()).toEqual(['e', 'd', 'c', 'b', 'a']);
		button('Show fewer')!.click();
		flushSync();
		expect(titles()).toEqual(['e', 'd', 'c']);
	});

	it('stays quiet for a kind the captain turned off', () => {
		bell.setKind('stuck', false);
		ring(alertOf(taskSummary('b', 'blocked', { statusLabel: 'Blocked', summary: 'x' })));
		expect(toastTitles()).toEqual([]);
		bell.setKind('stuck', true);
	});

	it('claims each raise once for this browser, across reloads', () => {
		const a = alertOf(prGreen('p'));
		expect(live.claim(a)).toBe(true);
		expect(live.claim(a)).toBe(false);
		expect(JSON.parse(localStorage.getItem('wheelhouse-bell-seen')!)).toEqual([raiseKey(a)]);
		// The PR green again later is a new raise.
		expect(live.claim({ ...a, at: new Date(NOW + 60_000).toISOString() })).toBe(true);
	});
});
