import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { mainSections } from '$lib/nav';
import { live } from '$lib/client/live.svelte';
import { firstmateChat } from '$lib/client/chat.svelte';
import type { FirstmateSessionView, SecondMate } from '$lib/types';
import { fleetOf, taskSummary } from '../../../../tests/helpers/task-summary';
import Sidebar from './Sidebar.test-fixture.svelte';

const mate = (id: string, host: string | null, o: Partial<SecondMate> = {}): SecondMate => ({
	id,
	where: host ? 'remote' : 'local',
	host,
	home: `/home/fm/${id}`,
	stateLabel: 'Working',
	tone: 'working',
	health: {
		online: 'online',
		text: 'Online',
		reason: null,
		observedAt: null,
		ageSeconds: 10,
		cached: false,
		host: { cpu: null, memory: null, disk: null },
		hostNote: null
	},
	projects: [],
	inFlight: [],
	queued: [],
	landed: [],
	prs: [],
	previews: [],
	previewNote: null,
	decisions: 0,
	captainDecisions: 0,
	omitted: [],
	lastReport: null,
	peek: { available: true, reason: null },
	...o
});
const session = (o: Partial<FirstmateSessionView> = {}): FirstmateSessionView =>
	({
		schema: 'wheelhouse-firstmate-session.v1',
		state: 'ours',
		reason: null,
		canSend: true,
		attach: null,
		skipPermissions: true,
		picker: null,
		menu: null,
		busy: false,
		...o
	}) as FirstmateSessionView;

const pages = [{ href: '/plugins/improve/proposals', label: 'Improvements' }];
const links = () =>
	[...document.querySelectorAll<HTMLAnchorElement>('aside nav a')].map((a) => ({
		href: a.getAttribute('href'),
		text: a.textContent?.replace(/\s+/g, ' ').trim(),
		current: a.getAttribute('aria-current')
	}));
const collapse = () => document.querySelector<HTMLButtonElement>('aside button')!;

let app: ReturnType<typeof mount> | null = null;
const open = (path = '/', decisionsOpen = 0) => {
	app = mount(Sidebar, {
		target: document.body,
		props: { sections: mainSections(path, pages), decisionsOpen }
	});
	flushSync();
};

beforeEach(() => {
	document.body.innerHTML = '';
	delete document.documentElement.dataset.nav;
	localStorage.clear();
});
afterEach(() => {
	if (app) unmount(app);
	app = null;
	live.fleet = null;
	firstmateChat.session = null;
	firstmateChat.connection = 'connecting';
	vi.unstubAllGlobals();
});

describe('the left-hand menu', () => {
	it('holds every main section, then the plugin pages, the current one marked', () => {
		open('/tasks/t1');
		expect(links().map((l) => l.text)).toEqual([
			'Firstmate',
			'Harbour',
			'Decisions',
			'Remotes',
			'Logbook',
			'Improvements'
		]);
		expect(links().filter((l) => l.current === 'page')).toEqual([
			{ href: '/harbour', text: 'Harbour', current: 'page' }
		]);
		expect(links().at(-1)!.href).toBe('/plugins/improve/proposals');
	});

	it('draws a plugin page’s own icon, an SVG in the menu’s ink, else the generic one', () => {
		app = mount(Sidebar, {
			target: document.body,
			props: {
				sections: mainSections('/', [
					{
						href: '/plugins/vault/overview',
						label: 'Vault',
						icon: '/api/plugins/vault/icon/overview.svg?v=1'
					},
					{
						href: '/plugins/acme/board',
						label: 'Board',
						icon: '/api/plugins/acme/icon/board.png?v=2'
					},
					...pages
				])
			}
		});
		flushSync();
		const item = (href: string) => document.querySelector(`aside a[href="${href}"]`)!;
		const stencil = item('/plugins/vault/overview').querySelector<HTMLElement>('.plugin-icon')!;
		expect(stencil.style.getPropertyValue('--icon')).toBe(
			"url('/api/plugins/vault/icon/overview.svg?v=1')"
		);
		expect(stencil.getAttribute('aria-hidden')).toBe('true');
		const img = item('/plugins/acme/board').querySelector('img')!;
		expect(img.getAttribute('src')).toBe('/api/plugins/acme/icon/board.png?v=2');
		expect(img.getAttribute('alt')).toBe('');
		const generic = item('/plugins/improve/proposals');
		expect(generic.querySelector('.plugin-icon, img')).toBeNull();
		expect(generic.querySelector('svg')).not.toBeNull();
	});

	it('counts the open decisions', () => {
		open('/', 3);
		const d = document.querySelector('aside a[href="/inbox"]')!;
		expect(d.getAttribute('aria-label')).toBe('Decisions, 3 open');
		expect(d.textContent).toContain('3');
	});

	it('folds to its icons and back, remembered in this browser', () => {
		open();
		expect(collapse().getAttribute('aria-label')).toBe('Collapse the menu');
		collapse().click();
		flushSync();
		expect(document.documentElement.dataset.nav).toBe('rail');
		expect(localStorage.getItem('wheelhouse-nav')).toBe('rail');
		expect(collapse().getAttribute('aria-label')).toBe('Expand the menu');
		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', ctrlKey: true, metaKey: true }));
		flushSync();
		expect(document.documentElement.dataset.nav).toBeUndefined();
		expect(localStorage.getItem('wheelhouse-nav')).toBe('full');
	});

	it('counts the work in play beside the Harbour, and a plugin page’s own badge', () => {
		live.fleet = fleetOf([
			taskSummary('a', 'working'),
			taskSummary('b', 'needs-review'),
			taskSummary('c', 'queued'),
			taskSummary('d', 'landed')
		]);
		app = mount(Sidebar, {
			target: document.body,
			props: {
				sections: mainSections('/', [
					{ href: '/plugins/review/reviews', label: 'Reviews', badge: 3 }
				])
			}
		});
		flushSync();
		const harbour = document.querySelector('aside a[href="/harbour"]')!;
		expect(harbour.getAttribute('aria-label')).toBe('Harbour, 2 in play');
		expect(harbour.textContent).toContain('2');
		const reviews = document.querySelector('aside a[href="/plugins/review/reviews"]')!;
		expect(reviews.getAttribute('aria-label')).toBe('Reviews, 3');
		expect(reviews.textContent).toContain('3');
	});

	it('lists the second mates: initials, where each runs and how it is', () => {
		live.fleet = {
			...fleetOf([]),
			secondMates: [
				mate('east-mate', 'build-box'),
				mate('docs-scout', null, { tone: 'captain', stateLabel: 'Needs your decision' }),
				mate('west-mate', 'test-rig', {
					health: { ...mate('x', null).health, online: 'offline', text: 'Offline' }
				})
			]
		};
		open();
		const rows = [...document.querySelectorAll<HTMLAnchorElement>('aside [data-mate]')];
		expect(document.getElementById('menu-mates')!.textContent).toBe('Second mates');
		expect(rows.map((r) => r.getAttribute('href'))).toEqual([
			'/second-mates#mate-east-mate',
			'/second-mates#mate-docs-scout',
			'/second-mates#mate-west-mate'
		]);
		expect(rows.map((r) => r.querySelector('.mate-avatar')!.textContent)).toEqual([
			'EM',
			'DS',
			'WM'
		]);
		expect(rows.map((r) => r.getAttribute('aria-label'))).toEqual([
			'east-mate, on build-box: Online',
			'docs-scout, on this computer: waiting on you',
			'west-mate, on test-rig: Offline'
		]);
		expect(rows[0].querySelector('.mate-dot')!.getAttribute('data-online')).toBe('online');
		expect(rows[1].querySelector('.mate-dot')!.getAttribute('data-tone')).toBe('captain');
		expect(rows[2].querySelector('.mate-dot')!.getAttribute('data-online')).toBe('offline');
	});

	it('leaves the second mates out when Firstmate runs none', () => {
		live.fleet = fleetOf([]);
		open();
		expect(document.getElementById('menu-mates')).toBeNull();
	});

	it('marks Firstmate working only while its own session is mid-turn', () => {
		open();
		const firstmate = () => document.querySelector('aside a[href="/"]')!;
		expect(firstmate().querySelector('.nav-working')).toBeNull();
		firstmateChat.connection = 'open';
		firstmateChat.session = session({ busy: true });
		flushSync();
		expect(firstmate().querySelector('.nav-working')!.textContent).toBe('Working');
		expect(firstmate().getAttribute('aria-label')).toBe('Firstmate, working');
		// Another terminal's session is read-only here: the chat says so, the menu stays quiet.
		firstmateChat.session = session({ state: 'external', canSend: false, busy: true });
		flushSync();
		expect(firstmate().querySelector('.nav-working')).toBeNull();
	});

	it('stops marking Firstmate working once the chat stream is closed', () => {
		const streams: EventTarget[] = [];
		class FakeEventSource extends EventTarget {
			static CLOSED = 2;
			readyState = 1;
			constructor() {
				super();
				streams.push(this);
			}
			close() {
				this.readyState = 2;
			}
		}
		vi.stubGlobal('EventSource', FakeEventSource);
		vi.stubGlobal('fetch', () => Promise.resolve(new Response('{"commands":[]}')));
		open('/harbour');
		const firstmate = () => document.querySelector('aside a[href="/"]')!;
		const disconnect = firstmateChat.connect();
		streams[0].dispatchEvent(
			new MessageEvent('session', { data: JSON.stringify(session({ busy: true })) })
		);
		flushSync();
		expect(firstmate().querySelector('.nav-working')!.textContent).toBe('Working');
		disconnect();
		flushSync();
		expect(firstmate().querySelector('.nav-working')).toBeNull();
		expect(firstmate().getAttribute('aria-label')).not.toBe('Firstmate, working');
	});
});
