import { flushSync, mount, tick, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cardHref, optionsFor, SNOOZE_KEY, type InboxCard, type InboxView } from '$lib/inbox';
import { inbox } from '$lib/client/inbox.svelte';
import { slideout } from '$lib/client/slideout.svelte';
import type { DecisionsView } from '$lib/types';

const hold: InboxCard = {
	id: 'upload:captain-hold',
	taskId: 'upload',
	taskTitle: 'Share links',
	projectId: 'lumen',
	kind: 'hold',
	key: 'captain-hold',
	question: 'Ship the share links behind a flag, or to everyone?',
	title: 'Ship the share links behind a flag, or to everyone?',
	origin: null,
	following: null,
	askedAt: null,
	owner: 'captain',
	evidence: {
		text: 'Flagged first keeps the old links working.',
		report: null,
		findings: [],
		file: null,
		pr: null,
		preview: null,
		previewTask: null,
		board: null,
		checks: null,
		screenshots: [],
		docs: []
	},
	options: optionsFor('hold'),
	recommendation: null,
	choices: null,
	sent: null
};
const first: InboxCard = { ...hold, id: 'search:captain-hold', taskId: 'search' };

const state = vi.hoisted(() => ({
	page: {
		data: { sessionToken: 'tok' } as Record<string, unknown>,
		url: new URL('http://wh.test/')
	}
}));
vi.mock('$app/state', () => state);
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

const { default: Page } = await import('./+page.svelte');
// The slide-outs every page shares, as the layout draws them.
const { default: SlideoutHost } = await import('$lib/components/wh/SlideoutHost.svelte');

const view: InboxView = {
	schema: 'wheelhouse-inbox.v1',
	available: true,
	reason: null,
	canAnswer: true,
	cards: [first, hold]
};

const none: DecisionsView = {
	schema: 'wheelhouse-decisions.v1',
	available: true,
	reason: null,
	decisions: []
};

let app: ReturnType<typeof mount> | null = null;
let host: ReturnType<typeof mount> | null = null;
beforeEach(() => {
	// Reduced motion: an answered question leaves without its stamp (happy-dom cannot run it).
	vi.stubGlobal('matchMedia', () => ({
		matches: true,
		addEventListener: () => {},
		removeEventListener: () => {}
	}));
});

afterEach(() => {
	if (app) unmount(app);
	app = null;
	if (host) unmount(host);
	host = null;
	slideout.close();
	document.body.innerHTML = '';
	vi.unstubAllGlobals();
	localStorage.clear();
	inbox.value = null;
	inbox.snoozed = {};
});

describe('the Decisions page', () => {
	const open = async (cards: InboxCard[], at = '/inbox', handled = none) => {
		const v = { ...view, cards };
		vi.stubGlobal(
			'fetch',
			vi.fn(async (url: string, init?: RequestInit) =>
				init?.method === 'POST'
					? Response.json({ message: { delivery: 'delivered' } })
					: new Response(JSON.stringify(v))
			)
		);
		state.page.url = new URL(`http://127.0.0.1:4310${at}`);
		host = mount(SlideoutHost, { target: document.body });
		app = mount(Page, {
			target: document.body,
			props: { data: { inbox: v, sessionToken: 'tok', handled } } as never
		});
		for (let i = 0; i < 3; i++) {
			flushSync();
			await tick();
			await new Promise((r) => setTimeout(r, 0));
		}
		flushSync();
	};
	const rows = () =>
		[...document.querySelectorAll<HTMLElement>('main [data-decision-row]')].map((r) =>
			r.id.replace(/^row-/, '')
		);
	const groups = () =>
		[...document.querySelectorAll<HTMLElement>('main [data-group]')].map((g) => g.dataset.group);
	const ago = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

	it('opens the decision a link names in the slide-out, even one asked about later', async () => {
		expect(cardHref(hold.id)).toBe('/inbox#card-upload%3Acaptain-hold');
		localStorage.setItem(SNOOZE_KEY, JSON.stringify({ [hold.id]: Date.now() + 3_600_000 }));
		// The ship's bell's Open decision for the upload task.
		await open([first, hold], '/inbox#card-upload%3Acaptain-hold');
		expect(slideout.panel).toMatchObject({ kind: 'decisions', cardId: hold.id });
		expect(inbox.snoozed[hold.id]).toBeUndefined();
		const out = document.querySelector<HTMLElement>('[data-decision-slideout]')!;
		expect(out.querySelector('article')!.id).toBe('card-upload:captain-hold');
		expect(out.textContent).toContain('2 of 2');
	});

	it('lists every open decision, what waits on you first, the longest waiting first', async () => {
		const settling: InboxCard = {
			...hold,
			id: 'pr-tab:nm-run-review',
			taskId: 'pr-tab',
			taskTitle: 'Review tab',
			kind: 'review',
			key: 'nm-run-review',
			owner: 'firstmate',
			askedAt: ago(30),
			question: 'Unrequested component: the frame-ancestors setting is not in the spec.',
			title: 'Unrequested component: the frame-ancestors setting is not in the spec.'
		};
		const newer = { ...first, askedAt: ago(1) };
		const older = { ...hold, askedAt: ago(5) };
		const talking = { ...hold, id: 'chat:captain-hold', taskId: 'chat', following: ago(2) };
		await open([settling, newer, talking, older]);
		expect(rows()).toEqual([older.id, newer.id, talking.id, settling.id]);
		expect(groups()).toEqual(['waiting', 'following', 'firstmate']);
		expect(document.querySelector('[data-decisions-summary]')!.textContent).toMatch(
			/2\s*waiting on you\s*4\s*open/
		);
		// Opened from the list, the slide-out walks the same list.
		document
			.querySelector<HTMLButtonElement>(`#row-${CSS.escape(newer.id)} [data-open-decision-row]`)!
			.click();
		await tick();
		flushSync();
		expect(slideout.panel).toMatchObject({ kind: 'decisions', cardId: newer.id });
		expect(document.querySelector('[data-decision-slideout]')!.textContent).toContain('2 of 4');
	});

	it('narrows to a type and a project from the address, and sorts by age when asked', async () => {
		const merge: InboxCard = {
			...hold,
			id: 'upload:merge-pr',
			kind: 'merge',
			key: 'merge-pr',
			askedAt: ago(3),
			options: optionsFor('merge')
		};
		const elsewhere = { ...first, projectId: 'atlas', askedAt: ago(9) };
		const cards = [{ ...hold, askedAt: ago(6) }, merge, elsewhere];
		await open(cards, '/inbox?type=merge');
		expect(rows()).toEqual([merge.id]);
		unmount(app!);
		unmount(host!);
		document.body.innerHTML = '';
		await open(cards, '/inbox?project=lumen&sort=newest');
		expect(rows()).toEqual([merge.id, hold.id]);
		expect(groups()).toEqual([]);
	});

	it('agrees from the line with what Firstmate recommends, through the inbox', async () => {
		const rec = { ...hold, recommendation: { choice: 'approve' as const, text: 'Flag it first.' } };
		await open([rec]);
		const agree = document.querySelector<HTMLButtonElement>('main [data-agree]')!;
		expect(agree.textContent!.trim()).toBe('Go ahead');
		agree.click();
		flushSync();
		await new Promise((r) => setTimeout(r, 0));
		const posted = (fetch as ReturnType<typeof vi.fn>).mock.calls.find(
			([u, i]) => u === '/api/inbox' && i?.method === 'POST'
		)!;
		expect(JSON.parse(posted[1].body)).toEqual({ cardId: hold.id, choice: 'approve', note: null });
		expect(posted[1].headers['idempotency-key']).toMatch(/^inbox-/);
		expect(rows()).toEqual([]);
	});

	it('keeps the calls Firstmate made itself folded below, where one can be taken over', async () => {
		const made: DecisionsView = {
			...none,
			decisions: [
				{
					id: 'd1',
					taskId: 'share',
					taskTitle: 'Share links',
					projectId: 'lumen',
					step: 'review',
					askedAt: ago(2),
					decidedAt: ago(1),
					verdict: 'Keep as is',
					calls: [
						{
							question: 'Expired links: a friendly page or an error?',
							detail: 'Expired tokens return 404.',
							file: null,
							serious: false,
							verdict: 'Keep as is',
							reason: 'People opening these links have no account.'
						}
					],
					answerCut: false,
					landed: false
				}
			]
		};
		await open([hold], '/inbox', made);
		const handled = document.querySelector<HTMLElement>('[data-handled]')!;
		expect(handled.textContent).toMatch(/Decided by Firstmate\s*1/);
		expect(handled.textContent).not.toContain('Expired links');
		handled.querySelector<HTMLButtonElement>('button')!.click();
		flushSync();
		handled.querySelector<HTMLButtonElement>('[data-made] button')!.click();
		flushSync();
		expect(handled.textContent).toContain('Expired links: a friendly page or an error?');
		expect(handled.textContent).toContain('Firstmate: Keep as is');
		expect(handled.querySelector('a[data-change-call]')?.getAttribute('href')).toMatch(
			/^\/\?chat=share&draft=/
		);
	});

	it('leaves the list alone while the captain types keys inside an open overlay', async () => {
		await open([first, hold]);
		const fetched = fetch as ReturnType<typeof vi.fn>;
		const sheet = document.createElement('div');
		sheet.setAttribute('role', 'dialog');
		sheet.setAttribute('aria-modal', 'true');
		sheet.tabIndex = -1;
		document.body.append(sheet);
		sheet.focus();
		const posts = () =>
			fetched.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'POST');
		for (const key of ['a', 'o', 'l']) {
			sheet.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
		}
		flushSync();
		await new Promise((r) => setTimeout(r, 0));
		expect(posts()).toHaveLength(0);
		expect(Object.keys(inbox.snoozed)).toHaveLength(0);
		// Focus falls to the page while the overlay stays open: still not for the list.
		sheet.blur();
		for (const key of ['a', 'o', 'l']) {
			document.body.dispatchEvent(
				new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
			);
		}
		flushSync();
		await new Promise((r) => setTimeout(r, 0));
		expect(posts()).toHaveLength(0);
		expect(Object.keys(inbox.snoozed)).toHaveLength(0);
		// Outside the overlay the same key still works.
		sheet.remove();
		document.body.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'l', bubbles: true, cancelable: true })
		);
		flushSync();
		expect(Object.keys(inbox.snoozed)).toHaveLength(1);
	});
});
