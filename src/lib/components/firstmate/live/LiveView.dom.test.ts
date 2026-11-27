import { flushSync, mount, tick, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { optionsFor, type InboxCard, type InboxView } from '$lib/inbox';
import { inbox } from '$lib/client/inbox.svelte';
import { calls } from '$lib/client/calls.svelte';
import { live } from '$lib/client/live.svelte';
import { firstmateChat } from '$lib/client/chat.svelte';
import { keptDiscussion, liveCall } from '$lib/client/livecall.svelte';
import { briefKey, readBrief } from '$lib/live/briefing';
import type { FleetView } from '$lib/types';
import { taskSummary } from '../../../../../tests/helpers/task-summary';

/*
 * Live mode on a synthetic fleet and inbox, with the discussion crew faked at
 * /api/live: voice starts off, the calls waiting on the captain are listed
 * and answered in place, an update is raised in the talk, the crew's replies
 * show in Live mode itself, and ending sends the briefing to Firstmate at once.
 */

const state = vi.hoisted(() => ({
	page: {
		data: { sessionToken: 'tok', features: { discussion: true } } as Record<string, unknown>,
		url: new URL('http://wh.test/')
	}
}));
vi.mock('$app/state', () => state);
const goto = vi.hoisted(() => vi.fn());
vi.mock('$app/navigation', () => ({ goto, afterNavigate: vi.fn() }));

const { default: LiveView } = await import('./LiveView.svelte');

const PRICING: InboxCard = {
	id: 'lumen-pricing:layout',
	taskId: 'lumen-pricing',
	taskTitle: 'Pricing page refresh',
	projectId: 'lumen',
	kind: 'decision',
	key: 'layout',
	question: 'Ship the three-tier pricing layout?',
	title: 'Ship the three-tier pricing layout?',
	origin: null,
	following: null,
	askedAt: new Date(Date.now() - 20 * 60_000).toISOString(),
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
	options: optionsFor('decision'),
	recommendation: null,
	choices: null,
	sent: null
};
const view = (cards: InboxCard[]): InboxView => ({
	schema: 'wheelhouse-inbox.v1',
	available: true,
	reason: null,
	canAnswer: true,
	cards
});

/** The crew's event stream, so a test can make it answer. */
let stream: { onmessage: ((m: { data: string }) => void) | null } | null = null;
let fetchMock: ReturnType<typeof vi.fn>;
let getUserMedia: ReturnType<typeof vi.fn>;
let turns = 0;
const said = () =>
	fetchMock.mock.calls
		.filter(([u]) => u === '/api/live/L1/say')
		.map(([, init]) => JSON.parse((init as RequestInit).body as string).text as string);
const crewSays = (turn: string, text: string) => {
	stream!.onmessage!({ data: JSON.stringify({ type: 'delta', turn, text }) });
	stream!.onmessage!({ data: JSON.stringify({ type: 'done', turn }) });
	flushSync();
};

let app: ReturnType<typeof mount> | null = null;
async function open() {
	await liveCall.start('tok');
	app = mount(LiveView, { target: document.body });
	flushSync();
}
const button = (root: ParentNode, text: string) =>
	[...root.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
		b.textContent?.trim().startsWith(text)
	)!;

beforeEach(() => {
	turns = 0;
	fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
		if (url === '/api/live')
			return Response.json({ id: 'L1', model: 'sonnet', knows: { live: 1, decisions: 1 } });
		if (url === '/api/live/L1/say') return Response.json({ turn: `t${++turns}` });
		if (url === '/api/live/L1/end')
			return Response.json({
				briefing: '## Decided\n- Ship the three-tier pricing layout.',
				quit: false,
				catchUp: [],
				minutes: 3,
				fleet: { live: 1, decisions: 0 }
			});
		if (url === '/api/inbox' && init) return Response.json({ message: { delivery: 'delivered' } });
		if (url === '/api/inbox') return Response.json(view([PRICING]));
		return new Promise<Response>(() => {});
	});
	vi.stubGlobal('fetch', fetchMock);
	vi.stubGlobal(
		'EventSource',
		class {
			onmessage: ((m: { data: string }) => void) | null = null;
			constructor(url: string) {
				// eslint-disable-next-line @typescript-eslint/no-this-alias -- the test drives the crew's stream
				if (url.startsWith('/api/live/')) stream = this;
			}
			addEventListener() {}
			close() {}
		}
	);
	getUserMedia = vi.fn(async () => {
		throw new Error('no microphone in tests');
	});
	Object.defineProperty(navigator, 'mediaDevices', {
		value: { getUserMedia },
		configurable: true
	});
	Element.prototype.scrollTo = vi.fn();
	calls.seen = {};
	inbox.value = view([PRICING]);
	live.fleet = {
		tasks: [
			taskSummary('sync', 'working', {
				shortTitle: 'Sync scout',
				busy: true,
				activity: { text: 'Reading the sync logs', at: new Date().toISOString(), source: 'status' }
			})
		],
		projects: []
	} as unknown as FleetView;
});

afterEach(async () => {
	if (app) unmount(app);
	app = null;
	if (liveCall.on) await liveCall.end(false);
	liveCall.shown = false;
	liveCall.entries = [];
	liveCall.toFirstmate = null;
	document.body.innerHTML = '';
	inbox.value = null;
	inbox.pending = {};
	live.fleet = null;
	firstmateChat.session = null;
	vi.unstubAllGlobals();
	localStorage.clear();
});

describe('Live mode', () => {
	it('starts with voice off: no microphone, a switch to turn it on, and the calm screen', async () => {
		await open();
		const voice = document.querySelector<HTMLButtonElement>('[role="switch"][aria-label="Voice"]')!;
		expect(voice.getAttribute('aria-checked')).toBe('false');
		expect(document.querySelector('[data-live-voice]')?.getAttribute('data-live-voice')).toBe(
			'off'
		);
		expect(getUserMedia).not.toHaveBeenCalled();
		expect(liveCall.voiceOn).toBe(false);
		expect(document.querySelector('[data-live-empty]')?.textContent).toContain(
			'What shall we work on?'
		);
		// No hold-to-talk while voice is off.
		expect(document.querySelector('[aria-label="Hold to talk"]')).toBeNull();
		// Turned on, it asks for the microphone.
		voice.click();
		await vi.waitFor(() => expect(getUserMedia).toHaveBeenCalled());
		expect(liveCall.voiceOn).toBe(true);
	});

	it('shows what the captain types and the crew’s reply in Live mode itself', async () => {
		await open();
		const box = document.querySelector<HTMLTextAreaElement>(
			'[aria-label="Message the discussion crew"]'
		)!;
		box.value = 'What is the riskiest task?';
		box.dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
		document.querySelector<HTMLButtonElement>('[aria-label="Send to the crew"]')!.click();
		await vi.waitFor(() => expect(said()).toEqual(['What is the riskiest task?']));
		await tick();
		crewSays('t1', 'The sync scout: it is reading logs nobody has read.');
		const talk = document.querySelector('[data-live-talk]')!;
		expect(talk.querySelector('[data-live-captain]')?.textContent).toContain(
			'What is the riskiest task?'
		);
		await vi.waitFor(() => {
			const crew = [...talk.querySelectorAll('[data-live-crew]')];
			expect(crew[crew.length - 1].textContent).toContain('it is reading logs nobody has read');
		});
	});

	it('lists the decisions waiting, opens one to answer in place, and talks it through', async () => {
		await open();
		const list = document.querySelector('[data-live-decisions]')!;
		expect(list.textContent).toContain('1 waiting');
		expect(list.textContent).toContain('Ship the three-tier pricing layout?');
		list.querySelector<HTMLButtonElement>('[data-live-decision-row]')!.click();
		flushSync();
		// Raised in the talk…
		await vi.waitFor(() =>
			expect(said()).toEqual([
				'Let\'s talk through the decision "Ship the three-tier pricing layout?" (decision id lumen-pricing:layout).'
			])
		);
		// Picked again it folds; opened again, it is not raised a second time.
		list.querySelector<HTMLButtonElement>('[data-live-decision-row]')!.click();
		flushSync();
		expect(list.querySelector('[data-live-decision-card]')).toBeNull();
		list.querySelector<HTMLButtonElement>('[data-live-decision-row]')!.click();
		flushSync();
		expect(said()).toHaveLength(1);
		// …and answered right there, as the Decisions page does.
		const card = list.querySelector('[data-live-decision-card] [data-chat-decision]')!;
		button(card, 'Go ahead').click();
		flushSync();
		const posted = fetchMock.mock.calls.find(([u, i]) => u === '/api/inbox' && i)!;
		expect(JSON.parse((posted[1] as RequestInit).body as string)).toMatchObject({
			cardId: 'lumen-pricing:layout',
			choice: 'approve'
		});
	});

	it('streams updates at the foot, and raises one in the talk when picked', async () => {
		await open();
		const line = document.querySelector<HTMLButtonElement>('[data-live-updates-line]')!;
		expect(line.textContent).toContain('Sync scout: Reading the sync logs');
		line.click();
		flushSync();
		document.querySelector<HTMLButtonElement>('[data-live-update="task"]')!.click();
		await vi.waitFor(() =>
			expect(said()).toEqual([
				"There's an update on “Sync scout”: Reading the sync logs. What's the story there?"
			])
		);
	});

	it('sends the briefing to Firstmate the moment the call ends, and steps aside to the chat', async () => {
		await open();
		const sent: string[] = [];
		liveCall.toFirstmate = async (text) => (sent.push(text), true);
		liveCall.type('Ship the pricing page.');
		await vi.waitFor(() => expect(said()).toHaveLength(1));
		await tick();
		crewSays('t1', 'Agreed: ship it.');
		document.querySelector<HTMLButtonElement>('[data-live-end-button]')!.click();
		flushSync();
		document.querySelector<HTMLButtonElement>('[data-live-end-brief]')!.click();
		await vi.waitFor(() => expect(sent).toHaveLength(1));
		expect(sent[0]).toBe(
			'Captain’s briefing from a Live mode discussion (3 min):\n\n## Decided\n- Ship the three-tier pricing layout.'
		);
		await vi.waitFor(() => expect(liveCall.shown).toBe(false));
		flushSync();
		expect(goto).toHaveBeenCalledWith('/');
		// The discussion is kept in this browser, for the chat's "Show the discussion".
		expect(keptDiscussion(briefKey(readBrief(sent[0])!.body))?.map((l) => l.text)).toEqual([
			expect.stringContaining("What's on your mind?"),
			'Ship the pricing page.',
			'Agreed: ship it.'
		]);
	});

	it('keeps a briefing that could not be sent, to send again', async () => {
		await open();
		let ok = false;
		liveCall.toFirstmate = async () => ok;
		liveCall.type('Ship the pricing page.');
		await vi.waitFor(() => expect(said()).toHaveLength(1));
		await liveCall.end(true);
		flushSync();
		expect(liveCall.shown).toBe(true);
		const brief = document.querySelector('[data-live-brief]')!;
		expect(brief.textContent).toContain('It could not be sent to Firstmate');
		ok = true;
		button(brief, 'Send to Firstmate').click();
		await vi.waitFor(() => expect(liveCall.shown).toBe(false));
	});
});
