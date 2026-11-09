import { flushSync, mount, tick, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { optionsFor, type InboxCard, type InboxChoices, type InboxView } from '$lib/inbox';
import { inbox } from '$lib/client/inbox.svelte';

vi.mock('$app/state', () => ({ page: { data: { sessionToken: 'tok' } } }));

const { default: DecisionStack } = await import('./DecisionStack.svelte');

const choices: InboxChoices = {
	intro: 'Gateway design calls',
	after: null,
	calls: [
		{
			id: '1',
			number: 1,
			prompt: 'First channel',
			required: true,
			options: [
				{ id: '1', label: 'Discord', detail: null, recommended: true },
				{ id: '2', label: 'Telegram', detail: null, recommended: false }
			]
		}
	]
};

const hold = (o: Partial<InboxCard> = {}): InboxCard => ({
	id: 'demo-gateway:captain-hold',
	taskId: 'demo-gateway',
	taskTitle: 'Messaging gateway',
	projectId: 'demo',
	kind: 'hold',
	key: 'captain-hold',
	question: 'Gateway design calls. 1) First channel: Discord (recommended) or Telegram',
	askedAt: null,
	owner: 'captain',
	evidence: {
		text: null,
		report: null,
		findings: [],
		file: null,
		pr: null,
		preview: null,
		checks: null,
		screenshots: []
	},
	options: optionsFor('hold', true),
	recommendation: null,
	choices,
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
const button = (text: string) =>
	[...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === text);
const show = () => {
	app = mount(DecisionStack, { target: document.body, props: { projects: [], now: Date.now() } });
	flushSync();
};

describe("On deck's Needs you decisions", () => {
	it('shows only what Firstmate escalated, and agrees with its recommendation in one tap', async () => {
		const theirs = hold({
			id: 'demo-theme:theme-choice',
			kind: 'decision',
			key: 'theme-choice',
			owner: 'firstmate',
			question: 'Navy or slate?'
		});
		inbox.value = view([hold(), theirs]);
		let reply: (r: Response) => void = () => {};
		const posts: Record<string, unknown>[] = [];
		vi.stubGlobal(
			'fetch',
			vi.fn((_url: string, init?: RequestInit) => {
				if (init?.method !== 'POST') return Promise.resolve(new Response('', { status: 503 }));
				posts.push(JSON.parse(String(init.body)));
				return new Promise<Response>((r) => (reply = r));
			})
		);
		show();
		// A worker's decision is Firstmate's to settle: not in the captain's stack.
		expect(document.querySelectorAll('article')).toHaveLength(1);
		expect(document.body.textContent).not.toContain('Navy or slate?');
		expect(document.querySelector('a[data-chat-about]')?.getAttribute('href')).toBe(
			'/?decision=demo-gateway%3Acaptain-hold'
		);
		button('Agree: Discord')!.click();
		flushSync();
		// Gone from the list at once, before Firstmate has it.
		expect(document.querySelector('article')).toBeNull();
		expect(posts).toEqual([
			{ cardId: 'demo-gateway:captain-hold', choice: 'approve', note: null, picks: { '1': '1' } }
		]);
		reply(new Response(JSON.stringify({ message: { delivery: 'delivered' } }), { status: 201 }));
		await settle();
		expect(document.querySelector('article')).toBeNull();
	});

	it('keeps a decision whose answer was not taken, with the reason', async () => {
		inbox.value = view([
			hold({
				choices: null,
				options: optionsFor('hold'),
				recommendation: { choice: 'approve', text: 'Ready.' }
			})
		]);
		vi.stubGlobal(
			'fetch',
			vi.fn(
				async () =>
					new Response(JSON.stringify({ message: 'Messaging to Firstmate is off.' }), {
						status: 503
					})
			)
		);
		show();
		button('Agree: Go ahead')!.click();
		await settle();
		expect(document.querySelectorAll('article')).toHaveLength(1);
		expect(document.querySelector('[role="alert"]')?.textContent).toBe(
			'Messaging to Firstmate is off.'
		);
	});
});
