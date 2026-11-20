import { flushSync, mount, tick, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cardHref, optionsFor, SNOOZE_KEY, type InboxCard, type InboxView } from '$lib/inbox';
import { inbox } from '$lib/client/inbox.svelte';
import { briefs } from '$lib/client/decisionbrief.svelte';
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
const nav = vi.hoisted(() => ({ goto: vi.fn() }));
vi.mock('$app/navigation', () => nav);

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
	// A wide screen, with reduced motion: an answered question leaves without its stamp.
	vi.stubGlobal('matchMedia', () => ({
		matches: true,
		addEventListener: () => {},
		removeEventListener: () => {}
	}));
});

afterEach(() => {
	if (app) unmount(app);
	app = null;
	nav.goto.mockReset();
	briefs.byCard = {};
	briefs.threads = {};
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
				url === '/api/inbox/talk'
					? Response.json({ reply: 'In short.', outcome: null, options: [] })
					: init?.method === 'POST'
						? Response.json({ message: { delivery: 'delivered' } })
						: new Response(JSON.stringify(v))
			)
		);
		state.page.url = new URL(`http://127.0.0.1:4310${at}`);
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
			r.closest('li')!.id.replace(/^row-/, '')
		);
	const groups = () =>
		[...document.querySelectorAll<HTMLElement>('main [data-group]')].map((g) => g.dataset.group);
	const pane = () => document.querySelector<HTMLElement>('[data-decision-pane]');
	const went = () => String(nav.goto.mock.calls.at(-1)?.[0] ?? '');
	const ago = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

	it('shows in each line what it asks, and each call with its options', async () => {
		const calls: InboxCard = {
			...hold,
			title: 'Trust design: accept the 2 recommendations?',
			question: 'Trust design has 2 calls; D1 matters most.',
			options: optionsFor('hold', true),
			choices: {
				intro: 'Trust design has 2 calls; D1 matters most.',
				after: null,
				calls: ['D1', 'D2'].map((id) => ({
					id,
					number: null,
					tag: id,
					key: id === 'D1',
					prompt: `Where does ${id} go?`,
					required: true,
					options: [
						{ id: 'a', label: 'a', detail: 'Per workspace', recommended: true },
						{ id: 'b', label: 'b', detail: 'Per org', recommended: false }
					]
				}))
			}
		};
		await open([calls]);
		const row = document.querySelector<HTMLElement>('main [data-decision-row]')!;
		expect(row.querySelector('[data-decision-asks]')!.textContent).toBe(
			'Trust design has 2 calls; D1 matters most.'
		);
		const listed = row.querySelector('[data-decision-calls]')!.textContent!.replace(/\s+/g, ' ');
		expect(listed).toContain('D1 Where does D1 go? a · Per workspace ★');
		expect(listed).toContain('b · Per org');
		expect(listed).toContain('D2 Where does D2 go?');
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
			/2 waiting on you\s*·\s*4 open/
		);
	});

	it('shows the first decision in full beside the list, and opens another from the list', async () => {
		await open([first, hold]);
		expect(pane()!.dataset.decisionPane).toBe(first.id);
		expect(
			document.querySelector(`#row-${CSS.escape(first.id)} button`)!.getAttribute('aria-current')
		).toBe('true');
		document.querySelector<HTMLButtonElement>(`#row-${CSS.escape(hold.id)} button`)!.click();
		expect(went()).toContain(`d=${encodeURIComponent(hold.id)}`);
	});

	it('opens the decision a link names, even one asked about later', async () => {
		expect(cardHref(hold.id)).toBe('/inbox?d=upload%3Acaptain-hold');
		inbox.load();
		localStorage.setItem(SNOOZE_KEY, JSON.stringify({ [hold.id]: Date.now() + 3_600_000 }));
		await open([first, hold], cardHref(hold.id));
		expect(pane()!.dataset.decisionPane).toBe(hold.id);
		expect(inbox.snoozed[hold.id]).toBeUndefined();
		// An old link to it (#card-<id>) goes to the same place.
		unmount(app!);
		document.body.innerHTML = '';
		await open([first, hold], '/inbox#card-upload%3Acaptain-hold');
		expect(went()).toContain('d=upload%3Acaptain-hold');
	});

	it('narrows to a type, a project or a task from the address, and sorts by age when asked', async () => {
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
		document.body.innerHTML = '';
		await open(cards, '/inbox?project=lumen&sort=newest');
		expect(rows()).toEqual([merge.id, hold.id]);
		expect(groups()).toEqual([]);
		unmount(app!);
		document.body.innerHTML = '';
		await open(cards, '/inbox?task=search');
		expect(rows()).toEqual([elsewhere.id]);
	});

	it('moves on to the next decision once one is answered', async () => {
		await open([first, hold]);
		document.querySelector<HTMLButtonElement>('[data-quick-pick="1"]')!.click();
		flushSync();
		document.querySelector<HTMLButtonElement>('[data-decide]')!.click();
		flushSync();
		expect(went()).toContain(`d=${encodeURIComponent(hold.id)}`);
		await new Promise((r) => setTimeout(r, 0));
		const posted = (fetch as ReturnType<typeof vi.fn>).mock.calls.find(
			([u, i]) => u === '/api/inbox' && i?.method === 'POST'
		)!;
		expect(JSON.parse(posted[1].body)).toMatchObject({ cardId: first.id, choice: 'approve' });
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
		nav.goto.mockReset();
		const sheet = document.createElement('div');
		sheet.setAttribute('role', 'dialog');
		sheet.setAttribute('aria-modal', 'true');
		sheet.tabIndex = -1;
		document.body.append(sheet);
		sheet.focus();
		for (const key of ['j', 'l']) {
			sheet.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
		}
		flushSync();
		expect(nav.goto).not.toHaveBeenCalled();
		expect(Object.keys(inbox.snoozed)).toHaveLength(0);
		// Outside the overlay the same keys work: j moves on, l asks again later.
		sheet.remove();
		document.body.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'j', bubbles: true, cancelable: true })
		);
		expect(went()).toContain(`d=${encodeURIComponent(hold.id)}`);
		document.body.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'l', bubbles: true, cancelable: true })
		);
		flushSync();
		expect(Object.keys(inbox.snoozed)).toEqual([first.id]);
	});
});
