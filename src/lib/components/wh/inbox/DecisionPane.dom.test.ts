import { flushSync, mount, tick, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { optionsFor, type InboxCard, type InboxView } from '$lib/inbox';
import { inbox } from '$lib/client/inbox.svelte';
import { briefs } from '$lib/client/decisionbrief.svelte';

const state = vi.hoisted(() => ({
	page: { data: { sessionToken: 'tok' } as Record<string, unknown> }
}));
vi.mock('$app/state', () => state);
const nav = vi.hoisted(() => ({ goto: vi.fn() }));
vi.mock('$app/navigation', () => nav);

const { default: DecisionPane } = await import('./DecisionPane.svelte');
const { liveCall } = await import('$lib/client/livecall.svelte');
const { decisionDrafts } = await import('$lib/client/decisiondrafts.svelte');

const hold: InboxCard = {
	id: 'docket:captain-hold',
	taskId: 'docket',
	taskTitle: 'Docket product shape',
	projectId: 'docket',
	kind: 'hold',
	key: 'docket',
	question: 'Docket shape: (B, recommended) shared core, or (C) cloud-only Enterprise?',
	title: 'Choose Docket’s product shape',
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
	options: optionsFor('hold'),
	recommendation: { choice: 'approve', text: 'Go ahead with B.' },
	choices: null,
	sent: null
};
const view: InboxView = {
	schema: 'wheelhouse-inbox.v1',
	available: true,
	reason: null,
	canAnswer: true,
	cards: [hold]
};

type Call = { url: string; body: Record<string, unknown>; headers: Record<string, string> };
let calls: Call[];
let brief: Record<string, unknown>;
let answer: Record<string, unknown>;
let app: ReturnType<typeof mount> | null = null;
let report: string | null;

beforeEach(() => {
	calls = [];
	brief = { reply: 'Pick Docket’s shape: B or C.', outcome: null, options: [] };
	answer = { reply: 'B keeps both doors open.', outcome: null, options: [] };
	report = null;
	inbox.value = view;
	briefs.byCard = {};
	briefs.threads = {};
	vi.stubGlobal(
		'fetch',
		vi.fn(async (url: string, init?: RequestInit) => {
			if (init?.method !== 'POST') {
				if (report !== null && url.startsWith('/api/inbox/report')) return new Response(report);
				return new Promise<Response>(() => {});
			}
			const body = JSON.parse(String(init.body)) as Record<string, unknown>;
			calls.push({ url, body, headers: init.headers as Record<string, string> });
			if (url === '/api/inbox/talk') return Response.json(body.mode === 'brief' ? brief : answer);
			return Response.json({ message: { delivery: 'delivered' } });
		})
	);
});

afterEach(() => {
	if (app) unmount(app);
	app = null;
	document.body.innerHTML = '';
	vi.unstubAllGlobals();
	inbox.value = null;
	inbox.pending = {};
	inbox.errors = {};
});

const settle = async () => {
	for (let i = 0; i < 5; i++) {
		await new Promise((r) => setTimeout(r, 0));
		await tick();
	}
	flushSync();
};
const show = async (onSent = vi.fn(), card: InboxCard = hold) => {
	app = mount(DecisionPane, {
		target: document.body,
		props: { card, project: 'docket', now: Date.now(), onSent }
	});
	await settle();
	return onSent;
};
const picks = () =>
	[...document.querySelectorAll<HTMLButtonElement>('[data-quick-pick]')].map((b) =>
		[...b.children].map((c) => c.textContent!.trim()).join(' ')
	);
const decide = () => document.querySelector<HTMLButtonElement>('[data-decide]')!;
const answers = () => calls.filter((c) => c.url === '/api/inbox');

describe('a decision in full', () => {
	it('opens short, with its options to pick, and sends the pick through the decision inbox', async () => {
		const onSent = await show();
		// Only the brief runs on opening; the crew is asked nothing until the captain asks.
		expect(calls.map((c) => c.body.mode)).toEqual(['brief']);
		expect(document.querySelector('[data-in-short]')!.textContent).toContain(
			'Pick Docket’s shape: B or C.'
		);
		expect(picks()).toEqual(['1 Go ahead recommended', '2 Not like this']);
		expect(decide().textContent).toContain('Decide: Go ahead');
		decide().click();
		await settle();
		expect(onSent).toHaveBeenCalled();
		expect(answers()).toHaveLength(1);
		expect(answers()[0].body).toEqual({ cardId: hold.id, choice: 'approve', note: null });
		expect(answers()[0].headers['idempotency-key']).toMatch(/^inbox-/);
	});

	it('picks from the options the question names, once the brief reads them', async () => {
		brief = {
			reply: 'B or C.',
			outcome: null,
			options: [
				{ n: 1, label: 'B: shared core', detail: 'one CLI', recommended: true },
				{ n: 2, label: 'C: cloud only', detail: null, recommended: false }
			]
		};
		await show();
		expect(picks()).toEqual(['1 B: shared core recommended', '2 C: cloud only']);
		document.querySelector<HTMLButtonElement>('[data-quick-pick="2"]')!.click();
		flushSync();
		decide().click();
		await settle();
		expect(answers()[0].body).toEqual({
			cardId: hold.id,
			choice: 'approve',
			note: null,
			decided: 'C: cloud only'
		});
	});

	it('sends the captain’s own words with Other', async () => {
		await show();
		document.querySelector<HTMLButtonElement>('[data-quick-other]')!.click();
		flushSync();
		expect(decide().disabled).toBe(true);
		const text = document.querySelector<HTMLTextAreaElement>('[data-other-text]')!;
		text.value = 'Neither yet: ask legal first.';
		text.dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
		expect(decide().textContent).toContain('Send your answer');
		decide().click();
		await settle();
		expect(answers()[0].body).toEqual({
			cardId: hold.id,
			choice: 'approve',
			note: null,
			decided: 'Neither yet: ask legal first.'
		});
	});

	it('answers a question from the crew, and offers what the talk came to as the answer', async () => {
		answer = {
			reply: 'Then **B**, with legal checked first.',
			outcome: { conclusion: 'B, after legal checks the hosting terms' },
			options: []
		};
		await show();
		const box = document.querySelector<HTMLTextAreaElement>('[data-pane-composer] textarea')!;
		box.value = 'ok, B, but check legal first';
		box.dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
		box.closest('form')!.requestSubmit();
		await settle();
		const asked = calls.find((c) => c.body.mode === 'ask')!;
		expect(asked.body.messages).toEqual([{ who: 'captain', text: 'ok, B, but check legal first' }]);
		expect(asked.body.options).toEqual([
			{ n: 1, label: 'Go ahead', detail: null, recommended: true },
			{ n: 2, label: 'Not like this', detail: null, recommended: false }
		]);
		expect(document.querySelector('[data-ask-captain]')!.textContent).toContain('check legal');
		expect(document.querySelector('[data-ask-crew] strong')!.textContent).toBe('B');
		const agreed = document.querySelector<HTMLElement>('[data-agreed]')!;
		expect(agreed.textContent).toContain('B, after legal checks the hosting terms');
		agreed.querySelector<HTMLButtonElement>('[data-send-agreed]')!.click();
		await settle();
		expect(answers()[0].body).toEqual({
			cardId: hold.id,
			choice: 'approve',
			note: null,
			decided: 'B, after legal checks the hosting terms'
		});
	});
});

describe('a decision read like a letter', () => {
	const trust: InboxCard = {
		...hold,
		id: 'trust-calls:captain-hold',
		taskId: 'trust-calls',
		taskTitle: 'Docket trust design: captain calls',
		key: 'trust-calls',
		title: 'Docket trust design: accept the 9 recommendations?',
		question:
			'Docket trust design has 9 calls (report §9). Accept all recommendations (recommended) / change some',
		origin: 'docket-trust-design',
		recommendation: null,
		evidence: {
			...hold.evidence,
			text: [
				'The trust design is ready.',
				'| # | Question |',
				'|---|---|',
				'| D1 | Where do policies live? |'
			].join('\n'),
			report: { path: 'data/docket-trust-design/report.md', url: '/api/inbox/report?card=x' },
			docs: [
				{
					path: 'data/docket-trust-design/report.md',
					kind: 'report',
					url: '/api/inbox/report?card=x&path=data%2Fdocket-trust-design%2Freport.md'
				}
			],
			preview: 'http://127.0.0.1:4871/'
		}
	};

	it('says who it is from, what is needed, and everything Firstmate wrote about it', async () => {
		await show(vi.fn(), trust);
		const from = document.querySelector('[data-decision-from]')!.textContent!.replace(/\s+/g, ' ');
		expect(from).toContain('Firstmate, on Docket trust design: captain calls');
		expect(from).toContain('from docket-trust-design');
		expect(document.querySelector('[data-decision-ask]')!.textContent).toContain(
			'What I need from you'
		);
		expect(document.querySelector('[data-decision-ask]')!.textContent).toContain('has 9 calls');
		// Firstmate's whole note, its table as a table.
		const background = document.querySelector('[data-decision-background]')!;
		expect(background.textContent).toContain('The trust design is ready.');
		expect(background.querySelector('table td')!.textContent).toBe('D1');
	});

	it('puts what it rests on first, each part folding away, and the answer last', async () => {
		await show(vi.fn(), trust);
		const parts = [...document.querySelectorAll<HTMLElement>('[data-pane-section]')].map(
			(el) => el.dataset.paneSection
		);
		expect(parts).toEqual(['background', 'preview', 'documents', 'answer']);
		const fold = document.querySelector<HTMLButtonElement>('#decision-background-title button')!;
		const body = document.getElementById('decision-background-body')!;
		expect(body.hidden).toBe(false);
		fold.click();
		flushSync();
		expect(fold.getAttribute('aria-expanded')).toBe('false');
		expect(body.hidden).toBe(true);
		// The way down to the answer, from the top.
		expect(document.querySelector<HTMLAnchorElement>('[data-jump-answer]')!.hash).toBe(
			'#decision-answer'
		);
	});

	it('embeds the report at the section the question names, and the live preview', async () => {
		report = [
			'# Trust',
			'## Summary',
			'Four parts.',
			'## 9. Captain decisions',
			'| # | Question |',
			'|---|---|',
			'| D1 | Where? |',
			'## 10. Phased build plan',
			'Phase 0.'
		].join('\n');
		await show(vi.fn(), trust);
		const source = document.querySelector<HTMLElement>('[data-source-section]')!;
		expect(source.dataset.sourceSection).toBe('9. Captain decisions');
		expect(source.textContent).toContain('Where?');
		expect(source.textContent).not.toContain('Phased build plan');
		expect(document.querySelector('[data-decision-preview] [data-decision-where]')).not.toBeNull();
	});
});

describe('a decision talked through in Live', () => {
	const calls: InboxCard = {
		...hold,
		id: 'trust:captain-hold',
		title: 'Trust design: accept the 2 recommendations?',
		question: 'Trust design has 2 calls.',
		options: optionsFor('hold', true),
		choices: {
			intro: 'Trust design has 2 calls.',
			after: null,
			calls: ['D1', 'D2'].map((id) => ({
				id,
				number: null,
				tag: id,
				prompt: `Where does ${id} go?`,
				required: true,
				options: [
					{ id: 'a', label: 'a', detail: 'Here', recommended: true },
					{ id: 'b', label: 'b', detail: 'There', recommended: false }
				]
			}))
		}
	};
	afterEach(() => {
		state.page.data = { sessionToken: 'tok' };
		decisionDrafts.byCard = {};
		nav.goto.mockReset();
		vi.restoreAllMocks();
	});

	it('offers Live only when Live mode is on, and opens it on this decision', async () => {
		await show(vi.fn(), calls);
		expect(document.querySelector('[data-talk-live]')).toBeNull();
		if (app) unmount(app);
		state.page.data = { sessionToken: 'tok', features: { discussion: true } };
		const start = vi.spyOn(liveCall, 'start').mockResolvedValue(undefined);
		await show(vi.fn(), calls);
		document.querySelector<HTMLButtonElement>('[data-talk-live]')!.click();
		expect(start).toHaveBeenCalledWith('tok', {
			decision: 'trust:captain-hold',
			title: 'Trust design: accept the 2 recommendations?'
		});
		// Live mode opens over this page: the answer it fills in waits here.
		expect(nav.goto).not.toHaveBeenCalled();
	});

	it('fills in the answer from what the talk came to, and sends nothing by itself', async () => {
		decisionDrafts.put('trust:captain-hold', {
			picks: { D2: 'b' },
			words: { D1: 'a, with an org baseline next year' },
			answer: null
		});
		await show(vi.fn(), calls);
		expect(document.querySelector('[data-live-draft]')!.textContent).toContain(
			'Filled in from your Live talk'
		);
		expect(
			document.querySelector<HTMLInputElement>(
				'input[name="pick-trust:captain-hold-D2"][value="b"]'
			)!.checked
		).toBe(true);
		expect(
			document.querySelector<HTMLTextAreaElement>('[data-decision-form] textarea')!.value
		).toBe('D1) Where does D1 go? a, with an org baseline next year');
		expect(answers()).toHaveLength(0);
		document.querySelector<HTMLButtonElement>('[data-send-partial]')!.click();
		await settle();
		expect(answers()[0].body).toMatchObject({
			cardId: 'trust:captain-hold',
			picks: { D2: 'b' },
			partial: true,
			note: 'D1) Where does D1 go? a, with an org baseline next year'
		});
		expect(decisionDrafts.byCard['trust:captain-hold']).toBeUndefined();
	});
});
