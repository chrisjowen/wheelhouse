import { flushSync, mount, tick, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cardHref, optionsFor, SNOOZE_KEY, type InboxCard, type InboxView } from '$lib/inbox';
import { inbox } from '$lib/client/inbox.svelte';

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

let app: ReturnType<typeof mount> | null = null;
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
			props: { data: { inbox: view, sessionToken: 'tok' } } as never
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
});
