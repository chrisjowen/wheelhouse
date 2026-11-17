import { flushSync, mount, tick, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { optionsFor, type InboxCard, type InboxView } from '$lib/inbox';
import { inbox } from '$lib/client/inbox.svelte';
import { slideout } from '$lib/client/slideout.svelte';
import { taskSummary } from '../../../../../tests/helpers/task-summary';

vi.mock('$app/state', () => ({
	page: { data: { sessionToken: 'tok' }, url: new URL('http://wh.test/tasks/upload') }
}));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

const { default: TaskDecisions } = await import('./TaskDecisions.svelte');
// The slide-outs every page shares, as the layout draws them.
const { default: SlideoutHost } = await import('../SlideoutHost.svelte');

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

const badge = () => document.querySelector<HTMLButtonElement>('[data-decisions-badge]');

describe("the task page's decisions", () => {
	it("shows a badge for the task's own questions, snoozed or not, that opens them in the Decisions slide-out", () => {
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
		badge()!.click();
		expect(slideout.panel).toMatchObject({
			kind: 'decisions',
			filter: { taskId: 'upload' },
			cardId: null
		});
	});

	it('answers its one question in the slide-out, then says Firstmate has it', async () => {
		inbox.value = view([card()]);
		const posts: unknown[] = [];
		vi.stubGlobal(
			'fetch',
			vi.fn(async (_url: string, init?: RequestInit) => {
				if (init?.method !== 'POST') return new Response('', { status: 503 });
				posts.push(JSON.parse(String(init.body)));
				return new Response(JSON.stringify({ message: { delivery: 'delivered' } }), {
					status: 201
				});
			})
		);
		app = mount(TaskDecisions, { target: document.body, props: { task: held } });
		host = mount(SlideoutHost, { target: document.body });
		flushSync();
		badge()!.click();
		await settle();
		const out = document.querySelector<HTMLElement>('[data-decision-slideout]')!;
		// Its own options (Firstmate's pick first), or the captain's own words.
		expect(
			[...out.querySelectorAll<HTMLInputElement>('input[type="radio"]')].map((r) => [
				r.value,
				r.checked
			])
		).toEqual([
			['A', true],
			['B', false],
			['other', false]
		]);
		out.querySelector<HTMLButtonElement>('[data-decide]')!.click();
		await settle();
		expect(posts).toEqual([
			{ cardId: 'upload:captain-hold', choice: 'approve', note: null, picks: { '1': 'A' } }
		]);
		expect(badge()).toBeNull();
		expect(document.querySelector('[data-decision-slideout]')?.textContent).toContain(
			'All answered'
		);
		expect(
			document
				.querySelector('[data-task-decisions-answered]')
				?.textContent?.replace(/\s+/g, ' ')
				.trim()
		).toBe('Your answer is with Firstmate, which passes it on to the crew.');
	});
});
