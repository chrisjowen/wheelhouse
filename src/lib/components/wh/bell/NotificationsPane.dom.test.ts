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
const { default: NotificationsPane } = await import('./NotificationsPane.svelte');
const { default: NotificationsSheet } = await import('./NotificationsSheet.svelte');

const NOW = Date.parse('2026-10-27T10:00:00Z');
const alertOf = (t: TaskSummary): ShipAlert => ({
	...alertsFor(t, NOW)[0],
	at: new Date(NOW).toISOString()
});
const ring = (a: ShipAlert, fresh = true) => {
	bell.receive({ type: 'alert', data: a, fresh });
	flushSync();
};
const titles = () => bell.log.map((a) => a.title);
const waitingTitles = () => bell.log.filter((a) => bell.waiting(a)).map((a) => a.title);
const openPane = () => {
	bell.open = true;
	flushSync();
};
const button = (label: string) =>
	[...document.querySelectorAll<HTMLElement>('button, a')].find(
		(b) => b.textContent?.trim() === label || b.getAttribute('aria-label') === label
	);

let apps: ReturnType<typeof mount>[] = [];
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
	localStorage.clear();
	live.fleet = null;
	fetchMock = vi.fn(
		async () => new Response(JSON.stringify({ replay: false, message: {} }), { status: 201 })
	);
	vi.stubGlobal('fetch', fetchMock);
	// Reduced motion, and a phone: the header's bell opens the layout's sheet.
	vi.stubGlobal('matchMedia', () => ({
		matches: true,
		addEventListener: () => {},
		removeEventListener: () => {}
	}));
	document.body.innerHTML = '';
	apps = [
		mount(NotificationsSheet, { target: document.body }),
		mount(NotificationsPane, { target: document.body })
	];
	flushSync();
});

afterEach(() => {
	for (const app of apps) void unmount(app);
	bell.log = [];
	bell.read = [];
	bell.settled = [];
	bell.pulse = 0;
	bell.open = false;
	bell.notes = {};
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

describe('notifications pane', () => {
	it('shows a green PR under Needs you with Merge, sending the captain note to Firstmate once', async () => {
		const a = alertOf(prGreen('share-links'));
		ring(a);
		live.fleet = fleetOf([prGreen('share-links')]);
		openPane();
		expect(document.body.textContent).toContain('Needs you');
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
		expect(bell.unread).toBe(0);
		// Once sent, another tap does nothing.
		await bell.act(a.actions[0], 'tok');
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('pops nothing up: a new alert only ticks the count and pulses once', () => {
		ring(alertOf(question('upload')));
		expect(bell.pulse).toBe(1);
		expect(document.querySelector('[role="alert"]')).toBeNull();
		expect(button('Notifications: 1 unread')).toBeTruthy();
		// Shown again after a reload: listed, but it does not pulse.
		ring(alertOf(taskSummary('m', 'landed')), false);
		expect(bell.pulse).toBe(1);
		expect(titles().sort()).toEqual(['m', 'upload']);
	});

	it('opens a row’s task, marks it read and closes the pane', () => {
		ring(alertOf(taskSummary('m', 'landed')));
		openPane();
		const row = document.querySelector<HTMLElement>('[data-alert] button')!;
		row.click();
		flushSync();
		expect(goto).toHaveBeenCalledWith('/tasks/m');
		expect(bell.unread).toBe(0);
		expect(bell.open).toBe(false);
		expect(JSON.parse(localStorage.getItem('wheelhouse-bell-read')!)).toHaveLength(1);
	});

	it('marks everything read at once', () => {
		ring(alertOf(taskSummary('m', 'landed')));
		ring(alertOf(question('q')));
		openPane();
		expect(document.body.textContent).toContain('2 unread');
		button('Mark all read')!.click();
		flushSync();
		expect(bell.unread).toBe(0);
		expect(document.body.textContent).toContain('All read');
	});

	it('clears an alert for good, until it is raised again', () => {
		const a = alertOf(question('upload'));
		ring(a);
		openPane();
		button('Clear upload')!.click();
		flushSync();
		expect(titles()).toEqual([]);
		expect(JSON.parse(localStorage.getItem('wheelhouse-bell-dismissed')!)).toEqual([raiseKey(a)]);
		ring(a, false);
		ring(a, true);
		expect(titles()).toEqual([]);
		// Asked again later: a new raise, so it is listed again.
		ring({ ...a, at: new Date(NOW + 60_000).toISOString() });
		expect(titles()).toEqual(['upload']);
	});

	it('clears the history but keeps what still needs you', () => {
		ring(alertOf(taskSummary('m', 'landed')));
		ring(alertOf(prGreen('p')));
		live.fleet = fleetOf([prGreen('p'), taskSummary('m', 'landed')]);
		openPane();
		button('Clear')!.click();
		flushSync();
		expect(titles()).toEqual(['p']);
	});

	it('ignores an earlier raise of an alert after a later one', () => {
		const later = { ...alertOf(prGreen('again')), at: new Date(NOW + 60_000).toISOString() };
		ring(later);
		live.fleet = fleetOf([prGreen('again')]);
		ring(alertOf(prGreen('again')), false);
		expect(bell.log.filter((a) => a.id === later.id).map((a) => a.at)).toEqual([later.at]);
	});

	it('moves a captain’s alert out of Needs you once its moment has passed', () => {
		ring(alertOf(prGreen('p')));
		live.fleet = fleetOf([prGreen('p')]);
		flushSync();
		expect(waitingTitles()).toEqual(['p']);
		live.fleet = fleetOf([taskSummary('p', 'landed')]);
		flushSync();
		expect(waitingTitles()).toEqual([]);
		expect(titles()).toEqual(['p']);
	});

	it('settles a session question once the server says it was answered', () => {
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
		expect(waitingTitles()).toEqual(['Firstmate']);
		bell.receive({ type: 'settled', data: q.id });
		flushSync();
		expect(waitingTitles()).toEqual([]);
	});

	it('groups the rest under its project', () => {
		ring(alertOf(taskSummary('m', 'landed')));
		ring(alertOf(taskSummary('n', 'landed')));
		openPane();
		const sections = [...document.querySelectorAll('section[aria-label]')].map((s) =>
			s.getAttribute('aria-label')
		);
		expect(sections).toEqual(['lumen']);
		expect(document.querySelectorAll('section[aria-label="lumen"] [data-alert]')).toHaveLength(2);
	});

	it('lists, but neither counts nor rings, a kind the captain turned off', () => {
		bell.setKind('stuck', false);
		ring(alertOf(taskSummary('b', 'blocked', { statusLabel: 'Blocked', summary: 'x' })));
		expect(titles()).toEqual(['b']);
		expect(bell.unread).toBe(0);
		expect(bell.pulse).toBe(0);
		bell.setKind('stuck', true);
	});

	it('keeps the bell sound setting in the pane’s settings', () => {
		openPane();
		button('Notification settings')!.click();
		flushSync();
		const sound = [...document.querySelectorAll('label')].find((l) =>
			l.textContent?.includes('Bell sound')
		)!;
		sound.querySelector('input')!.click();
		flushSync();
		expect(bell.settings.sound).toBe(true);
		expect(JSON.parse(localStorage.getItem('wheelhouse-bell')!).sound).toBe(true);
		bell.update({ sound: false });
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
