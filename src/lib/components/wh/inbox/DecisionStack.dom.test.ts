import { flushSync, mount, tick, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
	it('shows a decision in the Decisions page box, its options to pick, and sends the picks', async () => {
		inbox.value = view([hold()]);
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
		const radios = [...document.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
		expect(radios.map((r) => [r.value, r.checked])).toEqual([
			['1', true],
			['2', false]
		]);
		expect(document.body.textContent).not.toContain('Pick options');
		radios[1].click();
		flushSync();
		button('Send picks')!.click();
		flushSync();
		// Gone from the list at once, before Firstmate has it.
		expect(document.querySelector('article')).toBeNull();
		expect(posts).toEqual([
			{ cardId: 'demo-gateway:captain-hold', choice: 'approve', note: null, picks: { '1': '2' } }
		]);
		reply(new Response(JSON.stringify({ message: { delivery: 'delivered' } }), { status: 201 }));
		await settle();
		expect(document.querySelector('article')).toBeNull();
	});

	it('keeps a decision whose answer was not taken, with the reason', async () => {
		inbox.value = view([hold({ choices: null, options: optionsFor('hold') })]);
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
		button('Approve')!.click();
		await settle();
		expect(document.querySelectorAll('article')).toHaveLength(1);
		expect(document.querySelector('[role="alert"]')?.textContent).toBe(
			'Messaging to Firstmate is off.'
		);
	});
});
