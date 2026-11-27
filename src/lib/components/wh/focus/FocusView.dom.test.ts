import { flushSync, mount, tick, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { optionsFor, type InboxCard, type InboxView } from '$lib/inbox';
import { inbox } from '$lib/client/inbox.svelte';
import { calls } from '$lib/client/calls.svelte';
import { firstmateChat } from '$lib/client/chat.svelte';
import { seenKey } from '$lib/calls';

/*
 * Focus mode on a synthetic inbox: one call at a time, oldest first, a new
 * call never taking the place of the one being read, and the project picker
 * narrowing it with the rest waiting elsewhere.
 */

const state = vi.hoisted(() => ({
	page: {
		data: { sessionToken: 'tok' } as Record<string, unknown>,
		url: new URL('http://wh.test/')
	}
}));
vi.mock('$app/state', () => state);
vi.mock('$app/navigation', () => ({ goto: vi.fn(), afterNavigate: vi.fn() }));

const { default: FocusView } = await import('./FocusView.svelte');

const card = (id: string, minsAgo: number, o: Partial<InboxCard> = {}): InboxCard => ({
	id: `${id}:captain-hold`,
	taskId: id,
	taskTitle: id,
	projectId: 'lumen',
	kind: 'hold',
	key: id,
	question: `Call ${id}?`,
	title: `Call ${id}?`,
	origin: null,
	following: null,
	askedAt: new Date(Date.now() - minsAgo * 60_000).toISOString(),
	owner: 'captain',
	evidence: {
		text: null,
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
	sent: null,
	...o
});
const view = (cards: InboxCard[]): InboxView => ({
	schema: 'wheelhouse-inbox.v1',
	available: true,
	reason: null,
	canAnswer: true,
	cards
});

let app: ReturnType<typeof mount> | null = null;
const open = () => {
	app = mount(FocusView, { target: document.body });
	flushSync();
};
const front = () => document.querySelector<HTMLElement>('[data-focus-card]')?.dataset.focusCard;
const position = () =>
	document.querySelector('[data-focus-pager] [aria-live]')?.textContent?.replace(/\s+/g, ' ');

beforeEach(() => {
	vi.stubGlobal(
		'fetch',
		vi.fn(() => new Promise<Response>(() => {}))
	);
	vi.stubGlobal(
		'EventSource',
		class {
			addEventListener() {}
			close() {}
		}
	);
	state.page.url = new URL('http://wh.test/');
	calls.seen = {};
	calls.cleared = [];
});

afterEach(() => {
	if (app) unmount(app);
	app = null;
	document.body.innerHTML = '';
	inbox.value = null;
	inbox.pending = {};
	firstmateChat.session = null;
	vi.unstubAllGlobals();
	localStorage.clear();
});

describe('focus mode', () => {
	it('is almost empty when nothing needs the captain', () => {
		inbox.value = view([]);
		open();
		expect(document.querySelector('[data-focus-empty]')?.textContent).toMatch(
			/Nothing needs\s*you/
		);
		expect(document.querySelector('[data-focus-card]')).toBeNull();
		expect(document.querySelector('[data-calm-line]')).not.toBeNull();
	});

	it('shows one call at a time, oldest first, starting with the first not seen yet', () => {
		const a = card('a', 30);
		const b = card('b', 20);
		calls.seen = { [seenKey(a)]: Date.now() };
		inbox.value = view([b, a, card('theirs', 5, { owner: 'firstmate' })]);
		open();
		expect(front()).toBe('b:captain-hold');
		expect(position()).toBe('2 of 2');
		expect(document.querySelectorAll('[data-chat-decision]')).toHaveLength(1);
	});

	it('never lets a new call take the place of the one being read', async () => {
		const a = card('a', 30);
		const b = card('b', 20);
		inbox.value = view([a, b]);
		open();
		expect(front()).toBe('a:captain-hold');
		// The captain pages on to the second.
		document.querySelector<HTMLButtonElement>('[aria-label^="Next call"]')!.click();
		flushSync();
		expect(front()).toBe('b:captain-hold');
		// A new call arrives, not seen yet: it joins the end, and the card being read stays.
		inbox.value = view([a, b, card('c', 0)]);
		flushSync();
		await tick();
		expect(front()).toBe('b:captain-hold');
		expect(position()).toBe('2 of 3');
		expect(
			document.querySelector('[aria-label^="Next call"]')?.getAttribute('aria-label')
		).toContain('not seen yet');
	});

	it('narrows to the project picked, with the calls elsewhere behind a line', () => {
		state.page.url = new URL('http://wh.test/?project=atlas');
		inbox.value = view([card('a', 30), card('b', 20, { projectId: 'atlas' })]);
		open();
		expect(front()).toBe('b:captain-hold');
		expect(position()).toBe('1 of 1');
		expect(document.querySelector('[data-focus-elsewhere]')?.textContent).toMatch(
			/1 more waiting in other projects/
		);
	});

	it('keeps a call the captain saw that cleared itself, until it is put away', () => {
		const a = card('a', 30);
		inbox.value = view([]);
		calls.cleared = [{ card: a, at: new Date().toISOString() }];
		open();
		expect(front()).toBe('a:captain-hold');
		const cleared = document.querySelector<HTMLElement>('[data-cleared-call]')!;
		expect(cleared.textContent).toMatch(/This cleared itself at .*Nothing to do\./);
		cleared.querySelector<HTMLButtonElement>('[data-put-away]')!.click();
		flushSync();
		expect(document.querySelector('[data-focus-empty]')).not.toBeNull();
	});
});
