import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { firstmateChat } from '$lib/client/chat.svelte';
import { inbox } from '$lib/client/inbox.svelte';
import { discussText } from '$lib/chat/discuss';
import { optionsFor, type AnsweredDecision, type InboxCard, type InboxView } from '$lib/inbox';
import { taskSummary } from '../../../../tests/helpers/task-summary';

/*
 * Synthetic chat and inbox: decisions shown in the conversation at the time
 * they were asked, answered there and discussed in a thread under the card,
 * and a task's live preview under the reply about it.
 */

const state = vi.hoisted(() => ({ page: { data: {} as Record<string, unknown> } }));
vi.mock('$app/state', () => state);

const { default: Chat } = await import('./Chat.svelte');

const at = (m: string) => `2026-10-31T09:${m}:00.000Z`;
const record = (uuid: string, m: string, rest: Record<string, unknown>) => ({
	uuid,
	timestamp: at(m),
	sessionId: 's',
	...rest
});
const captain = (uuid: string, m: string, content: string) =>
	record(uuid, m, { type: 'user', message: { role: 'user', content } });
const firstmate = (uuid: string, m: string, text: string) =>
	record(uuid, m, {
		type: 'assistant',
		message: { id: uuid, role: 'assistant', content: [{ type: 'text', text }] }
	});
const done = (uuid: string, m: string) =>
	record(uuid, m, { type: 'system', subtype: 'turn_duration', durationMs: 1000 });

const PRICING: InboxCard = {
	id: 'lumen-pricing:layout',
	taskId: 'lumen-pricing',
	taskTitle: 'Pricing page refresh',
	projectId: 'lumen',
	kind: 'decision',
	key: 'layout',
	question: 'Ship the three-tier pricing layout?',
	askedAt: at('15'),
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
	options: optionsFor('decision'),
	recommendation: null,
	choices: null,
	sent: null
};

const BACKUPS: AnsweredDecision = {
	requestId: 'inbox-backups',
	cardId: 'lumen-backups:retry',
	taskId: 'lumen-backups',
	taskTitle: 'Nightly backups',
	projectId: 'lumen',
	kind: 'blocked',
	key: 'retry',
	question: 'Retry tonight’s backup against the new bucket?',
	askedAt: at('05'),
	choice: 'approve',
	label: 'Approve',
	picks: null,
	note: 'Keep the old bucket read-only for a month.',
	answeredAt: at('06'),
	delivery: 'delivered'
};

const view = (cards: InboxCard[] = [PRICING]): InboxView => ({
	schema: 'wheelhouse-inbox.v1',
	available: true,
	reason: null,
	canAnswer: true,
	cards,
	answered: [BACKUPS]
});

const ASK = discussText(
	{ taskId: 'lumen-pricing', key: 'layout', question: PRICING.question },
	'What’s the risk?'
);

let app: ReturnType<typeof mount>;
let fetchMock: ReturnType<typeof vi.fn>;

function start(records: Record<string, unknown>[], props: Record<string, unknown> = {}) {
	firstmateChat.records = records;
	document.body.innerHTML = '';
	app = mount(Chat, {
		target: document.body,
		props: {
			token: 't',
			railOpen: false,
			onToggleRail: () => {},
			health: { label: 'All quiet', tone: 'success' },
			now: Date.parse(at('40')),
			...props
		}
	});
	flushSync();
}

beforeEach(() => {
	fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
	vi.stubGlobal('fetch', fetchMock);
	Element.prototype.scrollIntoView = vi.fn();
	state.page.data = { inbox: view(), sessionToken: 't' };
	inbox.value = null;
	inbox.pending = {};
	firstmateChat.session = {
		schema: 'wheelhouse-firstmate-session.v1',
		state: 'ours',
		reason: null,
		canSend: true,
		attach: null,
		skipPermissions: false,
		picker: null,
		menu: null,
		busy: false
	};
});

afterEach(() => {
	unmount(app);
	for (const p of firstmateChat.pending) firstmateChat.dismiss(p.id);
	firstmateChat.records = [];
	firstmateChat.session = null;
	inbox.value = null;
	inbox.pending = {};
	vi.unstubAllGlobals();
});

const BASE = [
	captain('u1', '00', 'Morning.'),
	firstmate('a1', '01', 'Morning, Captain.'),
	done('d1', '01'),
	captain('u2', '20', 'Thanks.'),
	firstmate('a2', '21', 'Understood.'),
	done('d2', '21')
];

/** The chat's rows in order: a message's words, or a decision card's id. */
const rows = () =>
	[...document.querySelectorAll<HTMLElement>('[data-bubble], [data-chat-decision]')].map(
		(el) => el.dataset.chatDecision ?? el.textContent?.trim()
	);
const decision = (id: string) =>
	document.querySelector<HTMLElement>(`[data-chat-decision="${CSS.escape(id)}"]`)!;
const button = (root: ParentNode, text: string) =>
	[...root.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
		b.textContent?.trim().startsWith(text)
	)!;

describe('decisions in the chat', () => {
	it('shows each decision at the time it was asked, an answered one folded to its answer', () => {
		start(BASE);
		expect(rows()).toEqual([
			'Morning.',
			'Morning, Captain.',
			'answer:inbox-backups',
			'lumen-pricing:layout',
			'Thanks.',
			'Understood.'
		]);
		const open = decision('lumen-pricing:layout');
		expect(open.textContent).toMatch(/Ship the three-tier pricing layout\?/);
		expect(button(open, 'Approve')).toBeTruthy();
		const folded = decision('answer:inbox-backups');
		expect(folded.textContent).toMatch(/You answered\s+Approve/);
		expect(folded.textContent).toMatch(/Keep the old bucket read-only for a month\./);
		expect(folded.textContent).toMatch(/Firstmate has your answer/);
	});

	it('answers through the decision inbox, as the Decisions page does, and folds the card', async () => {
		// The inbox, read again once the answer is taken, shows the card as sent.
		const sent: InboxCard['sent'] = {
			choice: 'approve',
			picks: null,
			note: null,
			at: at('39'),
			delivery: 'delivered',
			detail: null,
			requestId: 'inbox-x'
		};
		fetchMock.mockImplementation(async (url: string, init?: RequestInit) =>
			url === '/api/inbox' && !init
				? Response.json(view([{ ...PRICING, sent }]))
				: Response.json({ message: { delivery: 'delivered' } })
		);
		start(BASE);
		button(decision('lumen-pricing:layout'), 'Approve').click();
		flushSync();
		const [url, init] = fetchMock.mock.calls.find(([u]) => u === '/api/inbox')!;
		expect(url).toBe('/api/inbox');
		expect(JSON.parse(init.body)).toEqual({
			cardId: 'lumen-pricing:layout',
			choice: 'approve',
			note: null
		});
		await vi.waitFor(() =>
			expect(fetchMock.mock.calls.some(([u, i]) => u === '/api/inbox' && !i)).toBe(true)
		);
		await vi.waitFor(() =>
			expect(
				decision('lumen-pricing:layout').querySelector('[data-answered]')?.textContent
			).toMatch(/You answered\s+Approve[\s\S]*Firstmate has your answer/)
		);
	});

	it('sends a question about a decision as a chat message naming it, shown in its thread', async () => {
		start(BASE);
		const card = decision('lumen-pricing:layout');
		button(card, 'Discuss').click();
		flushSync();
		button(card, 'What’s the risk?').click();
		flushSync();
		const sent = fetchMock.mock.calls.find(([u]) => u === '/api/firstmate/input')!;
		expect(JSON.parse(sent[1].body)).toEqual({ text: ASK });
		await vi.waitFor(() =>
			expect(card.querySelector('[data-discussion]')?.textContent).toMatch(/What’s the risk\?/)
		);
		// Not in the conversation itself.
		expect(rows().some((r) => typeof r === 'string' && r.includes('risk'))).toBe(false);
	});

	it('moves a question and Firstmate’s reply out of the conversation into the thread', () => {
		start([
			...BASE.slice(0, 3),
			captain('u3', '16', ASK),
			firstmate('a3', '17', 'Low risk: the middle tier may draw from the top one.'),
			done('d3', '17'),
			...BASE.slice(3)
		]);
		expect(rows()).toEqual([
			'Morning.',
			'Morning, Captain.',
			'answer:inbox-backups',
			'lumen-pricing:layout',
			'Thanks.',
			'Understood.'
		]);
		const thread = decision('lumen-pricing:layout').querySelector('[data-discussion]')!;
		expect(thread.textContent).toMatch(/What’s the risk\?/);
		expect(thread.textContent).toMatch(/Low risk: the middle tier may draw from the top one\./);
		expect(button(decision('lumen-pricing:layout'), 'Discuss').textContent).toMatch(/· 2/);
	});

	it('shows no decisions while the inbox is not available', () => {
		state.page.data = { inbox: { ...view(), available: false } };
		start(BASE);
		expect(document.querySelector('[data-chat-decision]')).toBeNull();
	});
});

describe('live previews in the chat', () => {
	it('shows a task’s preview under the reply about it, with its pull request', () => {
		const task = taskSummary('lumen-share-links', 'needs-review', {
			pr: { url: 'https://github.com/demo/lumen/pull/212', number: 212 },
			preview: { url: 'http://127.0.0.1:5240/', reportedAt: at('09') },
			pipeline: null
		});
		state.page.data = { inbox: view([]) };
		start(
			[
				captain('u1', '00', 'Morning.'),
				firstmate('a1', '10', 'The share links preview is up: http://127.0.0.1:5240'),
				done('d1', '10'),
				captain('u2', '20', 'Thanks.')
			],
			{ tasks: [task], projects: [{ id: 'lumen', name: 'Lumen' }] }
		);
		const card = document.querySelector<HTMLElement>('[data-chat-preview="live"]')!;
		expect(card).toBeTruthy();
		expect(card.closest('article')?.textContent).toMatch(/The share links preview is up/);
		expect(card.textContent).toMatch(/Live preview/);
		expect(card.textContent).toMatch(/Lumen/);
		expect(card.textContent).toMatch(/Pull request #212/);
		expect(fetchMock.mock.calls.some(([u]) => u === '/api/tasks/lumen-share-links/preview')).toBe(
			true
		);
	});
});
