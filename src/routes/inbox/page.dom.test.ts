import { flushSync, mount, tick, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cardHref, optionsFor, SNOOZE_KEY, type InboxCard, type InboxView } from '$lib/inbox';
import { inbox } from '$lib/client/inbox.svelte';
import type { DecisionsView } from '$lib/types';

const hold: InboxCard = {
	id: 'upload:captain-hold',
	taskId: 'upload',
	taskTitle: 'Share links',
	projectId: 'lumen',
	kind: 'hold',
	key: 'captain-hold',
	question: 'Ship the share links behind a flag, or to everyone?',
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
		screenshots: []
	},
	options: optionsFor('hold'),
	recommendation: null,
	choices: null,
	sent: null
};
const first: InboxCard = { ...hold, id: 'search:captain-hold', taskId: 'search' };

vi.mock('$app/state', () => ({
	page: {
		data: { sessionToken: 'tok' },
		// The ship's bell's Open decision for the upload task.
		url: new URL(`http://127.0.0.1:4310${'/inbox#card-upload%3Acaptain-hold'}`)
	}
}));

const { default: Page } = await import('./+page.svelte');

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
	document.body.innerHTML = '';
	vi.unstubAllGlobals();
	localStorage.clear();
	inbox.value = null;
	inbox.snoozed = {};
});

describe('the Decisions page', () => {
	it('opens the decision a link names, even one asked about later', async () => {
		expect(cardHref(hold.id)).toBe('/inbox#card-upload%3Acaptain-hold');
		localStorage.setItem(SNOOZE_KEY, JSON.stringify({ [hold.id]: Date.now() + 3_600_000 }));
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(JSON.stringify(view)))
		);
		Element.prototype.scrollIntoView = () => {};
		app = mount(Page, {
			target: document.body,
			props: { data: { inbox: view, sessionToken: 'tok', handled: none } } as never
		});
		flushSync();
		await tick();
		flushSync();
		const card = document.getElementById('card-upload:captain-hold');
		expect(card).not.toBeNull();
		expect(card!.getAttribute('aria-current')).toBe('true');
		// Its evidence is open.
		expect(card!.textContent).toContain('Flagged first keeps the old links working.');
		expect(inbox.snoozed[hold.id]).toBeUndefined();
	});

	it('puts only what Firstmate escalated under Needs you, and the rest folded under Handled', async () => {
		const review: InboxCard = {
			...hold,
			id: 'pr-tab:nm-run-review',
			taskId: 'pr-tab',
			taskTitle: 'Review tab',
			kind: 'review',
			key: 'nm-run-review',
			owner: 'firstmate',
			question: 'Unrequested component: the frame-ancestors setting is not in the spec.'
		};
		const made: DecisionsView = {
			...none,
			decisions: [
				{
					id: 'd1',
					taskId: 'share',
					taskTitle: 'Share links',
					projectId: 'lumen',
					step: 'review',
					askedAt: new Date(Date.now() - 7_200_000).toISOString(),
					decidedAt: new Date(Date.now() - 3_600_000).toISOString(),
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
		const both = { ...view, cards: [hold, review] };
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(JSON.stringify(both)))
		);
		Element.prototype.scrollIntoView = () => {};
		app = mount(Page, {
			target: document.body,
			props: { data: { inbox: both, sessionToken: 'tok', handled: made } } as never
		});
		flushSync();
		await tick();
		flushSync();
		const needs = document.querySelector('[aria-label="Questions for you"]')!;
		expect(needs.querySelectorAll('article')).toHaveLength(1);
		expect(needs.textContent).toContain('Ship the share links');
		expect(document.body.textContent).not.toContain('Unrequested component');
		const handled = document.querySelector<HTMLElement>('[data-handled]')!;
		expect(handled.textContent).toMatch(/Handled by Firstmate\s*2/);
		handled.querySelector<HTMLButtonElement>('button')!.click();
		flushSync();
		expect(handled.textContent).toContain('Unrequested component');
		expect(handled.querySelector('a[data-chat-about]')?.getAttribute('href')).toBe(
			'/?decision=pr-tab%3Anm-run-review'
		);
		expect(handled.textContent).toContain('Expired links: a friendly page or an error?');
		expect(handled.textContent).toContain('Firstmate: Keep as is');
	});

	it('stays put when the captain agrees with a question Firstmate is settling', async () => {
		// The link opens it under Handled by Firstmate; Needs you still has another question.
		const settling: InboxCard = {
			...hold,
			owner: 'firstmate',
			recommendation: { choice: 'approve', text: 'Flag it first.' }
		};
		const both = { ...view, cards: [first, settling] };
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(JSON.stringify(both)))
		);
		const scrolled: string[] = [];
		Element.prototype.scrollIntoView = function (this: Element) {
			scrolled.push(this.id);
		};
		app = mount(Page, {
			target: document.body,
			props: { data: { inbox: both, sessionToken: 'tok', handled: none } } as never
		});
		flushSync();
		await tick();
		flushSync();
		const handled = document.querySelector<HTMLElement>('[data-handled]')!;
		const agree = handled.querySelector<HTMLButtonElement>('[data-agree]')!;
		expect(agree).not.toBeNull();
		scrolled.length = 0;
		agree.click();
		flushSync();
		await new Promise((r) => setTimeout(r, 0));
		expect(scrolled).not.toContain('card-search:captain-hold');
	});

	it('leaves the cards alone while the captain types keys inside an open overlay', async () => {
		const fetched = vi.fn(
			async (_url: string, _init?: RequestInit) => new Response(JSON.stringify(view))
		);
		vi.stubGlobal('fetch', fetched);
		Element.prototype.scrollIntoView = () => {};
		app = mount(Page, {
			target: document.body,
			props: { data: { inbox: view, sessionToken: 'tok', handled: none } } as never
		});
		flushSync();
		await tick();
		flushSync();
		const sheet = document.createElement('div');
		sheet.setAttribute('role', 'dialog');
		sheet.setAttribute('aria-modal', 'true');
		sheet.tabIndex = -1;
		document.body.append(sheet);
		sheet.focus();
		const posts = () => fetched.mock.calls.filter(([, init]) => init?.method === 'POST');
		for (const key of ['a', 'c', 'l']) {
			sheet.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
		}
		flushSync();
		await new Promise((r) => setTimeout(r, 0));
		expect(posts()).toHaveLength(0);
		expect(inbox.snoozed[hold.id]).toBeUndefined();
		expect(inbox.snoozed[first.id]).toBeUndefined();
		// Focus falls to the page while the overlay stays open: still not for the cards.
		sheet.blur();
		for (const key of ['a', 'c', 'l']) {
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
