import { flushSync, mount, tick, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { optionsFor, type InboxCard, type InboxView } from '$lib/inbox';
import { inbox } from '$lib/client/inbox.svelte';
import { taskSummary } from '../../../../../tests/helpers/task-summary';

vi.mock('$app/state', () => ({
	page: { data: { sessionToken: 'tok' }, url: new URL('http://wh.test/tasks/upload') }
}));

const { default: TaskDecisions } = await import('./TaskDecisions.svelte');

const card = (o: Partial<InboxCard> = {}): InboxCard => ({
	id: 'upload:captain-hold',
	taskId: 'upload',
	taskTitle: 'upload',
	projectId: 'lumen',
	kind: 'hold',
	key: 'captain-hold',
	question: 'Ship the share links behind a flag? A) flag (recommended) B) everyone',
	title: 'Ship the share links behind a flag? A) flag (recommended) B) everyone',
	origin: null,
	following: null,
	askedAt: null,
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
	options: optionsFor('hold', true),
	recommendation: null,
	choices: {
		intro: 'Ship the share links behind a flag?',
		after: null,
		calls: [
			{
				id: '1',
				number: null,
				prompt: null,
				required: true,
				options: [
					{ id: 'A', label: 'A', detail: 'flag', recommended: true },
					{ id: 'B', label: 'B', detail: 'everyone', recommended: false }
				]
			}
		]
	},
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

const held = taskSummary('upload', 'needs-decision', {
	attention: {
		kind: 'decision',
		owner: 'captain',
		text: 'Ship the share links behind a flag?',
		url: null
	}
});

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
	inbox.value = null;
	inbox.pending = {};
	inbox.errors = {};
	inbox.snoozed = {};
});

const settle = async () => {
	for (let i = 0; i < 5; i++) {
		await new Promise((r) => setTimeout(r, 0));
		await tick();
	}
	flushSync();
};

const badge = () => document.querySelector<HTMLAnchorElement>('a[data-decisions-badge]');

describe("the task page's decisions", () => {
	it("shows a badge for the task's own questions, snoozed or not, that opens the Decisions page on them", () => {
		inbox.value = view([
			card(),
			card({ id: 'other:captain-hold', taskId: 'other' }),
			card({ id: 'upload:merge-pr', kind: 'merge', key: 'merge-pr', options: optionsFor('merge') })
		]);
		inbox.snoozed = { 'upload:captain-hold': Date.now() + 60_000 };
		app = mount(TaskDecisions, { target: document.body, props: { task: held } });
		flushSync();
		// No copy of a decision on the task page: a badge for its two, merge call included.
		expect(document.querySelector('article')).toBeNull();
		expect(badge()!.textContent).toMatch(/2 decisions\s*all waiting on you/);
		expect(badge()!.getAttribute('href')).toBe('/inbox?task=upload');
	});

	it('opens the page on its only question, and says Firstmate has the answer once it is sent', async () => {
		inbox.value = view([card()]);
		vi.stubGlobal(
			'fetch',
			vi.fn(async (_url: string, init?: RequestInit) =>
				init?.method === 'POST'
					? new Response(JSON.stringify({ message: { delivery: 'delivered' } }), { status: 201 })
					: new Promise<Response>(() => {})
			)
		);
		app = mount(TaskDecisions, { target: document.body, props: { task: held } });
		flushSync();
		expect(badge()!.getAttribute('href')).toBe('/inbox?task=upload&d=upload%3Acaptain-hold');
		void inbox.answer(card(), 'approve', null, 'tok');
		await settle();
		expect(badge()).toBeNull();
		expect(
			document
				.querySelector('[data-task-decisions-answered]')
				?.textContent?.replace(/\s+/g, ' ')
				.trim()
		).toBe('Your answer is with Firstmate, which passes it on to the crew.');
	});
});
