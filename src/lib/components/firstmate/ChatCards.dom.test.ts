import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { firstmateChat } from '$lib/client/chat.svelte';
import { inbox } from '$lib/client/inbox.svelte';
import { previewChecks } from '$lib/client/previewchecks.svelte';
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
		previewTask: null,
		board: null,
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
	// The transcript has arrived, as it has by the time the captain reads the chat.
	firstmateChat.synced = true;
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
	previewChecks.clear();
	for (const p of firstmateChat.pending) firstmateChat.dismiss(p.id);
	firstmateChat.records = [];
	firstmateChat.synced = false;
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
		// A decision without named options is answered with the two plain answers that fit it.
		expect(button(open, 'Go ahead')).toBeTruthy();
		expect(button(open, 'Change course')).toBeTruthy();
		expect(button(open, 'Approve')).toBeFalsy();
		const folded = decision('answer:inbox-backups');
		expect(folded.textContent).toMatch(/You decided\s+Go ahead/);
		expect(folded.textContent).toMatch(/Keep the old bucket read-only for a month\./);
		expect(folded.textContent).toMatch(/Firstmate has it and passes it on/);
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
		button(decision('lumen-pricing:layout'), 'Go ahead').click();
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
			).toMatch(/You decided\s+Go ahead[\s\S]*Firstmate has it and passes it on/)
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

	it('turns Discuss off, with the reason, for a decision whose key Firstmate cannot be told', () => {
		const odd = { ...PRICING, id: 'lumen-pricing:page layout', key: 'page layout' };
		state.page.data = { inbox: view([odd]), sessionToken: 't' };
		start(BASE);
		const discuss = button(decision('lumen-pricing:page layout'), 'Discuss');
		expect(discuss.disabled).toBe(true);
		expect(discuss.title).toMatch(/cannot be asked about it here/);
	});

	it('opens a merge call’s pull request in the review tool, beside Merge and Not yet', () => {
		const pr = 'https://github.com/demo/lumen/pull/212';
		const merge: InboxCard = {
			...PRICING,
			id: 'lumen-pricing:merge-pr',
			kind: 'merge',
			key: 'merge-pr',
			question: 'Merge pull request #212? Its checks are green.',
			evidence: { ...PRICING.evidence, pr: { url: pr, number: 212 }, checks: 'green' },
			options: optionsFor('merge')
		};
		const tabs = { lumen: '/projects/lumen/pr-review/review?pr={url}' };
		state.page.data = { inbox: view([merge]), sessionToken: 't', pullRequestTabs: tabs };
		start(BASE);
		const card = decision('lumen-pricing:merge-pr');
		const answers = card.querySelector('[role="group"]')!;
		const review = card.querySelector<HTMLAnchorElement>('a[data-review-pr]')!;
		expect(review.textContent?.trim()).toBe('Review');
		expect(review.getAttribute('href')).toBe(
			`/projects/lumen/pr-review/review?pr=${encodeURIComponent(pr)}`
		);
		expect(review.target).toBe('');
		for (const b of ['Merge', 'Not yet']) expect(button(answers, b)).toBeTruthy();

		// With no review plugin on for the project, Review is the pull request on GitHub.
		unmount(app);
		state.page.data = { inbox: view([merge]), sessionToken: 't' };
		start(BASE);
		const plain =
			decision('lumen-pricing:merge-pr').querySelector<HTMLAnchorElement>('a[data-review-pr]')!;
		expect(plain.getAttribute('href')).toBe(pr);
		expect(plain.target).toBe('_blank');
	});

	it('replaces the form with the one Firstmate writes in its reply, and sends the words decided', async () => {
		const reply = [
			'The middle tier may draw from the top one. Two ways to soften it:',
			'',
			'```decision-form',
			'Which layout should ship?',
			'- Three tiers, middle one highlighted (recommended)',
			'- Two tiers only: drops the middle tier',
			'- Three tiers as built',
			'```'
		].join('\n');
		fetchMock.mockImplementation(async () => Response.json({ message: { delivery: 'delivered' } }));
		start([
			...BASE.slice(0, 3),
			captain('u3', '16', ASK),
			firstmate('a3', '17', reply),
			done('d3', '17'),
			...BASE.slice(3)
		]);
		const card = decision('lumen-pricing:layout');
		expect(card.querySelector('[data-refined]')).not.toBeNull();
		const form = card.querySelector<HTMLElement>('[data-decision-form]')!;
		expect(form.dataset.formFrom).toBe('firstmate');
		expect(form.textContent).toContain('Which layout should ship?');
		// The thread shows Firstmate's words without the block.
		const thread = card.querySelector('[data-discussion]')!;
		expect(thread.textContent).toContain('Two ways to soften it');
		expect(thread.textContent).not.toContain('decision-form');
		const decide = card.querySelector<HTMLButtonElement>('[data-decide]')!;
		expect(decide.textContent!.trim()).toBe('Decide: Three tiers, middle one highlighted');
		decide.click();
		flushSync();
		const posted = fetchMock.mock.calls.find(([u, i]) => u === '/api/inbox' && i)!;
		expect(JSON.parse(posted[1].body)).toEqual({
			cardId: 'lumen-pricing:layout',
			choice: 'approve',
			note: null,
			decided: 'Three tiers, middle one highlighted'
		});
	});

	it('folds the talk about an earlier question asked under the same card id', () => {
		const reply = [
			'Two ways to go:',
			'',
			'```decision-form',
			'Which layout should ship?',
			'- Three tiers (recommended)',
			'- Two tiers',
			'```'
		].join('\n');
		const asked = { ...PRICING, question: 'Keep the annual discount at 20%?', askedAt: at('30') };
		state.page.data = { inbox: view([asked]), sessionToken: 't' };
		start([
			...BASE.slice(0, 3),
			captain('u3', '16', ASK),
			firstmate('a3', '17', reply),
			done('d3', '17'),
			captain(
				'u4',
				'31',
				discussText(
					{ taskId: 'lumen-pricing', key: 'layout', question: asked.question },
					'Why 20%?'
				)
			),
			firstmate('a4', '32', 'It matches what the old page offered.'),
			done('d4', '32'),
			...BASE.slice(3)
		]);
		const card = decision('lumen-pricing:layout');
		const thread = card.querySelector('[data-discussion]')!;
		const earlier = thread.querySelector<HTMLDetailsElement>('details[data-earlier]')!;
		expect(earlier.open).toBe(false);
		expect(earlier.querySelector('summary')!.textContent).toBe(
			`Earlier question: “${PRICING.question}”`
		);
		expect(earlier.textContent).toContain('What’s the risk?');
		expect(earlier.textContent).toContain('Two ways to go:');
		// The old form neither answers the new question nor claims to have changed its options.
		expect(thread.textContent).not.toContain('Firstmate updated the options above.');
		expect(card.querySelector('[data-refined]')).toBeNull();
		// The talk about the current question stays outside the fold.
		const current = [...thread.querySelectorAll('li')].filter(
			(li) => !li.closest('details') && !li.querySelector('details')
		);
		expect(current.map((li) => li.textContent)).toEqual([
			expect.stringContaining('Why 20%?'),
			expect.stringContaining('It matches what the old page offered.')
		]);
	});

	it('leaves out a question Firstmate is settling until it is opened from the Decisions page', async () => {
		const review: InboxCard = {
			...PRICING,
			id: 'lumen-pr-tab:nm-review',
			taskId: 'lumen-pr-tab',
			kind: 'review',
			key: 'nm-review',
			owner: 'firstmate',
			question: 'Unrequested setting: keep it?',
			askedAt: at('10')
		};
		state.page.data = { inbox: view([PRICING, review]), sessionToken: 't' };
		// A read of the inbox (a refresh left by an earlier answer) returns the same view.
		fetchMock.mockImplementation(async (url: string, init?: RequestInit) =>
			url === '/api/inbox' && !init ? Response.json(view([PRICING, review])) : Response.json({})
		);
		start(BASE);
		expect(document.querySelector('[data-chat-decision="lumen-pr-tab:nm-review"]')).toBeNull();
		unmount(app);
		const { composerBus } = await import('./bus.svelte');
		composerBus.decision = 'lumen-pr-tab:nm-review';
		start(BASE);
		const card = decision('lumen-pr-tab:nm-review');
		expect(card.textContent).toContain('Firstmate is handling it; yours to take over');
		// It comes into view with its discussion open, ready to ask about it.
		await vi.waitFor(() => expect(card.querySelector('[data-discussion]')).not.toBeNull());
		await vi.waitFor(() => expect(composerBus.decision).toBeNull());
		// Opened once, it stays in the conversation.
		flushSync();
		expect(decision('lumen-pr-tab:nm-review')).not.toBeNull();
		localStorage.clear();
	});

	it('brings a decision into view only once the transcript has arrived, so it opens where it was asked', async () => {
		// Chat about this lands on the home page before the transcript does: the page connects to
		// the chat stream on arrival, and the decision (from the page's inbox) is there at once.
		const { composerBus } = await import('./bus.svelte');
		firstmateChat.synced = false;
		composerBus.decision = PRICING.id;
		start([]);
		// The transcript takes a moment to come over the stream.
		await new Promise((r) => setTimeout(r, 20));
		flushSync();
		// Not brought into view yet: with no transcript the card sits at the end, and it moves up to
		// where it was asked (09:15, before "Thanks.") once the transcript arrives.
		expect(composerBus.decision).toBe(PRICING.id);
		expect(rows().at(-1)).toBe(PRICING.id);
		firstmateChat.records = BASE;
		flushSync();
		firstmateChat.synced = true;
		flushSync();
		const card = decision(PRICING.id);
		expect(rows().indexOf(PRICING.id)).toBe(rows().indexOf('Thanks.') - 1);
		// In its place, with its discussion open and ready to type in.
		await vi.waitFor(() => expect(composerBus.decision).toBeNull());
		expect(card.isConnected).toBe(true);
		expect(card.querySelector('[data-discussion]')).not.toBeNull();
		expect(card.contains(document.activeElement)).toBe(true);
		expect(document.activeElement?.getAttribute('aria-label')).toBe(
			'Ask Firstmate about this question'
		);
		localStorage.clear();
	});

	it('keeps a decision brought into view from the chat’s end, rather than following the latest', async () => {
		// The captain reads the latest at the bottom of a long chat, then picks Chat about this on
		// deck beside it: the home page stays, and only the decision changes.
		const { composerBus } = await import('./bus.svelte');
		start(BASE);
		const list = document.querySelector<HTMLElement>('.overflow-y-auto')!;
		Object.defineProperty(list, 'scrollHeight', { configurable: true, value: 9000 });
		Object.defineProperty(list, 'clientHeight', { configurable: true, value: 700 });
		list.scrollTop = 8300;
		list.dispatchEvent(new Event('scroll'));
		const card = decision(PRICING.id);
		card.getBoundingClientRect = () => ({ top: -4000 }) as DOMRect;
		const scrolls: number[] = [];
		list.scrollTo = ((o: ScrollToOptions) => {
			scrolls.push(o.top!);
			list.scrollTop = o.top!;
		}) as typeof list.scrollTo;

		composerBus.decision = PRICING.id;
		flushSync();
		await vi.waitFor(() => expect(composerBus.decision).toBeNull());
		// Whatever the chat would have done to follow the latest has had its turn.
		await new Promise((r) => setTimeout(r, 20));
		flushSync();
		// Up to the card (24px under the top) once, and not back down to the end.
		expect(scrolls).toEqual([8300 - 4000 - 24]);
		expect(card.querySelector('[data-discussion]')).not.toBeNull();
		expect(card.contains(document.activeElement)).toBe(true);
		// New messages while it is in view do not pull the chat back down either.
		firstmateChat.records = [...BASE, firstmate('a3', '30', 'One more thing.')];
		flushSync();
		await new Promise((r) => setTimeout(r, 20));
		expect(list.scrollTop).toBe(8300 - 4000 - 24);
		localStorage.clear();
	});

	it('shows no decisions while the inbox is not available', () => {
		state.page.data = { inbox: { ...view(), available: false } };
		start(BASE);
		expect(document.querySelector('[data-chat-decision]')).toBeNull();
	});
});

describe('preview feedback in the chat', () => {
	it('shows a list sent from a preview as the captain’s card to Firstmate, where it was sent', async () => {
		const { live } = await import('$lib/client/live.svelte');
		const { batchText } = await import('$lib/previewhelper');
		live.messages = {
			schema: 'wheelhouse-messages.v1',
			available: true,
			reason: null,
			receiptsAt: null,
			receiptsError: null,
			messages: [
				{
					requestId: 'wh-batch',
					text: batchText({ id: 'lumen-share', title: 'Share links' }, 'http://127.0.0.1:5240/', [
						{ text: 'Make links last 30 days' }
					]),
					taskId: 'lumen-share',
					submittedAt: at('10'),
					delivery: 'delivered',
					deliveryDetail: null,
					acknowledged: true,
					noteId: 'n1',
					reply: { body: 'Passed to the worker.', at: at('11') }
				}
			]
		} as never;
		state.page.data = { inbox: view([]), sessionToken: 't' };
		start(BASE);
		const card = document.querySelector<HTMLElement>('[data-feedback-batch]')!;
		expect(card.textContent).toContain('To Firstmate · preview feedback');
		expect(card.textContent).toContain('Make links last 30 days');
		expect(card.textContent).toContain('Firstmate has it and passes it to the same task');
		expect(card.textContent).toContain('Passed to the worker.');
		// Between the morning messages and the later ones, at the time it was sent.
		const order = [
			...document.querySelectorAll<HTMLElement>('[data-bubble], [data-feedback-batch]')
		].map((el) => (el.dataset.feedbackBatch !== undefined ? 'batch' : el.textContent?.trim()));
		expect(order).toEqual(['Morning.', 'Morning, Captain.', 'batch', 'Thanks.', 'Understood.']);
		live.messages = null;
	});

	it('shows a plugin’s feedback list as the captain’s card too, naming the plugin and what it is about', async () => {
		const { live } = await import('$lib/client/live.svelte');
		const { pluginBatchText } = await import('$lib/previewhelper');
		live.messages = {
			schema: 'wheelhouse-messages.v1',
			available: true,
			reason: null,
			receiptsAt: null,
			receiptsError: null,
			messages: [
				{
					requestId: 'wh-plan',
					text: pluginBatchText(
						{ id: 'lumen-plan', title: 'Plan share links' },
						{ id: 'plan-review', name: 'Plan review' },
						'plan.md: Request changes',
						[{ text: 'Add a rollback step', points: '“Ship it” (line 12)' }]
					),
					taskId: 'lumen-plan',
					submittedAt: at('10'),
					delivery: 'delivered',
					deliveryDetail: null,
					acknowledged: null,
					noteId: 'n1',
					reply: null
				}
			]
		} as never;
		state.page.data = { inbox: view([]), sessionToken: 't' };
		start(BASE);
		const card = document.querySelector<HTMLElement>('[data-feedback-batch]')!;
		expect(card.getAttribute('aria-label')).toMatch(/^Your Plan review feedback, /);
		expect(card.textContent).toContain('To Firstmate · Plan review feedback');
		expect(card.textContent).toContain('About plan.md: Request changes');
		expect(card.textContent).toContain('Points at “Ship it” (line 12)');
		expect(card.querySelector('a')!.getAttribute('href')).toBe('/tasks/lumen-plan');
		live.messages = null;
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

	it('says a preview that does not answer has stopped, with no link to open it', async () => {
		const task = taskSummary('lumen-share-links', 'needs-review', {
			pr: { url: 'https://github.com/demo/lumen/pull/212', number: 212 },
			preview: { url: 'http://127.0.0.1:5240/', reportedAt: at('09') },
			pipeline: null
		});
		fetchMock.mockImplementation(async (url: string) =>
			url === '/api/tasks/lumen-share-links/preview'
				? Response.json({
						url: 'http://127.0.0.1:5240/',
						reportedAt: at('09'),
						state: 'down',
						reason: 'The worker will bring it back; it shows here again as soon as it answers.',
						checkedAt: at('40')
					})
				: new Response('{}', { status: 200 })
		);
		state.page.data = { inbox: view([]) };
		start(
			[
				firstmate('a1', '10', 'The share links preview is up: http://127.0.0.1:5240'),
				done('d1', '10')
			],
			{ tasks: [task], projects: [{ id: 'lumen', name: 'Lumen' }] }
		);
		const card = document.querySelector<HTMLElement>('[data-chat-preview="live"]')!;
		await vi.waitFor(() => expect(card.textContent).toMatch(/The worker will bring it back/));
		expect(card.textContent).toMatch(/Preview stopped/);
		expect(card.textContent).not.toMatch(/Full size|New tab|Live preview/);
		expect(card.querySelector('iframe')).toBeNull();
		expect(card.querySelector('a[href^="http://127.0.0.1"]')).toBeNull();
		// The pull request is still there to review.
		expect(card.textContent).toMatch(/Pull request #212/);
	});

	// The regression: a preview Firstmate links that no task reported with a `preview <url>` line
	// (a server of its own, a forwarded port, a board) showed no box at all.
	it('shows a live box for a preview Firstmate links that no task reported', async () => {
		fetchMock.mockImplementation(async (url: string) =>
			url === `/api/previews/check?url=${encodeURIComponent('http://127.0.0.1:45391/?style=c')}`
				? Response.json({
						url: 'http://127.0.0.1:45391/?style=c',
						reportedAt: null,
						state: 'live',
						reason: null,
						checkedAt: at('40')
					})
				: new Response('{}', { status: 200 })
		);
		state.page.data = { inbox: view([]) };
		start(
			[
				firstmate(
					'a1',
					'10',
					'Forwarded here: **http://127.0.0.1:45391/?style=c**, or set `http://localhost:3000/cb`.'
				),
				done('d1', '10')
			],
			{ tasks: [], projects: [] }
		);
		const boxes = document.querySelectorAll<HTMLElement>('[data-chat-preview-for="link"]');
		expect(boxes).toHaveLength(1);
		expect(boxes[0].closest('article')?.textContent).toMatch(/Forwarded here/);
		expect(boxes[0].textContent).toMatch(/127\.0\.0\.1:45391/);
		await vi.waitFor(() =>
			expect(boxes[0].querySelector('[data-live-preview]')?.getAttribute('data-live-preview')).toBe(
				'live'
			)
		);
		expect(boxes[0].textContent).toMatch(/Full size/);
	});

	it('links a task’s review board from its card', () => {
		const task = taskSummary('lumen-onboarding', 'needs-decision', {
			preview: { url: 'http://127.0.0.1:4873/', reportedAt: at('09') },
			board: { url: 'http://127.0.0.1:4387/session/c03d', reportedAt: at('09') }
		});
		state.page.data = { inbox: view([]) };
		start(
			[
				firstmate(
					'a1',
					'10',
					'On the board: http://127.0.0.1:4387/session/c03d (direct: http://127.0.0.1:4873/)'
				),
				done('d1', '10')
			],
			{ tasks: [task], projects: [{ id: 'lumen', name: 'Lumen' }] }
		);
		const cards = document.querySelectorAll<HTMLElement>('[data-chat-preview]');
		// One card: the task's, with its board linked, not a second box for either address.
		expect(cards).toHaveLength(1);
		expect(cards[0].dataset.chatPreviewFor).toBe('task');
		expect(cards[0].querySelector('a[data-open-board]')?.getAttribute('href')).toBe(
			'http://127.0.0.1:4387/session/c03d'
		);
	});

	it('leaves the board link out while a plugin is the review surface', () => {
		const task = taskSummary('lumen-onboarding', 'needs-decision', {
			preview: { url: 'http://127.0.0.1:4873/', reportedAt: at('09') },
			board: { url: 'http://127.0.0.1:4387/session/c03d', reportedAt: at('09') }
		});
		state.page.data = { inbox: view([]), reviewSurface: { id: 'hr', name: 'Human Review' } };
		start(
			[
				firstmate('a1', '10', 'Ready: http://127.0.0.1:4873/ for lumen-onboarding.'),
				done('d1', '10')
			],
			{ tasks: [task], projects: [{ id: 'lumen', name: 'Lumen' }] }
		);
		const cards = document.querySelectorAll<HTMLElement>('[data-chat-preview]');
		expect(cards).toHaveLength(1);
		expect(cards[0].querySelector('a[data-open-board]')).toBeNull();
	});

	it('offers Review in the review tool while a plugin is on for the project, else only the PR link', () => {
		const pr = 'https://github.com/demo/lumen/pull/212';
		const task = taskSummary('lumen-share-links', 'landed', {
			pr: { url: pr, number: 212 },
			preview: { url: 'http://127.0.0.1:5240/', reportedAt: at('09') },
			pipeline: null
		});
		const records = [
			firstmate('a1', '10', 'Landed lumen-share-links.'),
			done('d1', '10'),
			captain('u2', '20', 'Thanks.')
		];
		state.page.data = {
			inbox: view([]),
			pullRequestTabs: { lumen: '/projects/lumen/pr-review/review?pr={url}' }
		};
		start(records, { tasks: [task], projects: [{ id: 'lumen', name: 'Lumen' }] });
		const card = () => document.querySelector<HTMLElement>('[data-chat-preview]')!;
		expect(card().querySelector('a[data-review-pr]')?.getAttribute('href')).toBe(
			`/projects/lumen/pr-review/review?pr=${encodeURIComponent(pr)}`
		);

		unmount(app);
		state.page.data = { inbox: view([]) };
		start(records, { tasks: [task], projects: [{ id: 'lumen', name: 'Lumen' }] });
		expect(card().querySelector('a[data-review-pr]')).toBeNull();
		expect(card().querySelector(`a[href="${pr}"]`)?.textContent).toMatch(/Pull request #212/);
	});
});

describe('MCP apps in the chat', () => {
	const search = (uuid: string, m: string) =>
		record(uuid, m, {
			type: 'assistant',
			message: {
				id: uuid,
				role: 'assistant',
				content: [
					{
						type: 'tool_use',
						id: 'toolu_1',
						name: 'mcp__docket__docket_search',
						input: { query: 'billing' }
					}
				]
			}
		});
	const found = (uuid: string, m: string) =>
		record(uuid, m, {
			type: 'user',
			message: {
				role: 'user',
				content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: '{"hits":[]}' }]
			}
		});
	const READY = {
		schema: 'wheelhouse-app.v1',
		state: 'ready',
		server: { id: 'docket', title: 'Docket' },
		tool: { name: 'docket_search' },
		html: '<!doctype html><p>graph</p>',
		csp: {},
		prefersBorder: true,
		input: { query: 'billing' },
		sandbox: 'http://127.0.0.1:5999/sandbox.html?csp=%7B%7D&sig=signed'
	};
	const CARD = '[data-chat-app="toolu_1"]';
	const toggle = () => document.querySelector<HTMLButtonElement>(`${CARD} button`)!;
	const opened = () => fetchMock.mock.calls.filter(([u]) => u === '/api/apps/open').length;

	it('opens an app expanded, keeps it up as the chat goes on, and remembers a collapse', async () => {
		fetchMock.mockImplementation(async (url: string) =>
			url === '/api/apps/chat'
				? Response.json({
						schema: 'wheelhouse-chat-apps.v1',
						apps: {
							toolu_1: {
								plugin: 'docket',
								server: { id: 'docket', title: 'Docket' },
								title: 'Search'
							}
						}
					})
				: url === '/api/apps/open'
					? Response.json(READY)
					: Response.json({})
		);
		const records = [
			captain('u1', '00', 'What does billing touch?'),
			search('a1', '01'),
			found('r1', '01')
		];
		start(records);
		await vi.waitFor(() => expect(document.querySelector(`${CARD} iframe`)).not.toBeNull());
		expect(toggle().getAttribute('aria-expanded')).toBe('true');
		expect(opened()).toBe(1);

		// More of the conversation lands: the app stays up, not opened (or run) again.
		firstmateChat.records = [
			...records,
			firstmate('a2', '02', 'Billing touches three services.'),
			done('d1', '02')
		];
		flushSync();
		await new Promise((r) => setTimeout(r, 0));
		expect(document.querySelector(`${CARD} iframe`)).not.toBeNull();
		expect(opened()).toBe(1);

		// Collapsed, it stays collapsed as the chat goes on.
		toggle().click();
		flushSync();
		expect(document.querySelector(`${CARD} iframe`)).toBeNull();
		firstmateChat.records = [
			...firstmateChat.records,
			captain('u2', '03', 'Thanks.'),
			firstmate('a3', '04', 'Any time.'),
			done('d2', '04')
		];
		flushSync();
		expect(toggle().getAttribute('aria-expanded')).toBe('false');
		expect(document.querySelector(`${CARD} iframe`)).toBeNull();
		expect(opened()).toBe(1);
	});
});
