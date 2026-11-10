import { flushSync, mount, tick, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { optionsFor, type InboxCard, type InboxView } from '$lib/inbox';
import { inbox } from '$lib/client/inbox.svelte';
import { taskSummary } from '../../../../../tests/helpers/task-summary';

vi.mock('$app/state', () => ({ page: { data: { sessionToken: 'tok' } } }));

const { default: TaskDecisions } = await import('./TaskDecisions.svelte');

const card = (o: Partial<InboxCard> = {}): InboxCard => ({
	id: 'upload:captain-hold',
	taskId: 'upload',
	taskTitle: 'upload',
	projectId: 'lumen',
	kind: 'hold',
	key: 'captain-hold',
	question: 'Ship the share links behind a flag? A) flag (recommended) B) everyone',
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
		screenshots: []
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

describe("the task page's decisions", () => {
	it("shows the task's own questions in the decision box, picks and all, snoozed or not", () => {
		inbox.value = view([
			card(),
			card({ id: 'other:captain-hold', taskId: 'other' }),
			card({ id: 'upload:merge-pr', kind: 'merge', key: 'merge-pr', options: optionsFor('merge') })
		]);
		inbox.snoozed = { 'upload:captain-hold': Date.now() + 60_000 };
		app = mount(TaskDecisions, { target: document.body, props: { task: held, now: Date.now() } });
		flushSync();
		expect(document.querySelectorAll('article')).toHaveLength(1);
		expect(document.querySelector('article')!.id).toBe('card-upload:captain-hold');
		// Answered in the chat, or with one tap on Firstmate's recommendation.
		expect(document.querySelectorAll('input[type="radio"]')).toHaveLength(0);
		expect(document.querySelector('a[data-chat-about]')?.getAttribute('href')).toBe(
			'/?decision=upload%3Acaptain-hold'
		);
		// Looking at the task, there is no asking later.
		const labels = [...document.querySelectorAll('button')].map((b) => b.textContent!.trim());
		expect(labels).toEqual(['Evidence', 'Agree: A (flag)']);
	});

	it('takes an answered question away at once and says Firstmate has it', async () => {
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
		app = mount(TaskDecisions, { target: document.body, props: { task: held, now: Date.now() } });
		flushSync();
		document.querySelector<HTMLButtonElement>('[data-agree]')!.click();
		flushSync();
		expect(document.querySelector('article')).toBeNull();
		await settle();
		expect(posts).toEqual([
			{ cardId: 'upload:captain-hold', choice: 'approve', note: null, picks: { '1': 'A' } }
		]);
		expect(document.querySelector('article')).toBeNull();
		expect(
			document.querySelector('[role="status"]')?.textContent?.replace(/\s+/g, ' ').trim()
		).toBe('Your answer is with Firstmate, which passes it on to the crew.');
	});
});
