import { afterEach, describe, expect, it, vi } from 'vitest';
import { optionsFor, type InboxCard, type InboxView } from '$lib/inbox';
import { inbox } from './inbox.svelte';

const card = (o: Partial<InboxCard> = {}): InboxCard => ({
	id: 'demo-search:merge-pr',
	taskId: 'demo-search',
	taskTitle: 'Search',
	projectId: 'demo',
	kind: 'merge',
	key: 'merge-pr',
	question: 'Merge pull request #12? Its checks are green.',
	askedAt: null,
	owner: 'captain',
	evidence: {
		text: null,
		report: null,
		findings: [],
		file: null,
		pr: null,
		preview: null,
		checks: 'green',
		screenshots: []
	},
	options: optionsFor('merge'),
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

/** A fake /api/inbox: the POST reply given, and GET returning the view given. */
function server(post: { status: number; body: unknown }, get: InboxView) {
	vi.stubGlobal(
		'fetch',
		vi.fn(async (_url: string, init?: RequestInit) =>
			init?.method === 'POST'
				? new Response(JSON.stringify(post.body), { status: post.status })
				: new Response(JSON.stringify(get), { status: 200 })
		)
	);
}

afterEach(() => {
	vi.unstubAllGlobals();
	inbox.value = null;
	inbox.pending = {};
	inbox.errors = {};
});

describe('inbox answers', () => {
	it('puts a card back, with the reason, when Firstmate did not take the answer', async () => {
		const c = card();
		inbox.value = view([c]);
		server(
			{
				status: 201,
				body: { replay: false, message: { delivery: 'failed', deliveryDetail: 'note refused' } }
			},
			view([c])
		);
		expect(await inbox.answer(c, 'approve', null, 'token')).toBe(false);
		expect(inbox.pending).toEqual({});
		expect(inbox.errors[c.id]).toBe('note refused');
		expect(inbox.cards()[0].sent).toBeNull();
		expect(inbox.open(Date.now())).toBe(1);
	});

	it('takes an answered card out of every list at once, before Firstmate has it', async () => {
		vi.useFakeTimers();
		try {
			const c = card();
			const other = card({ id: 'demo-pay:captain-hold', taskId: 'demo-pay', kind: 'hold' });
			inbox.value = view([c, other]);
			// The server still shows the question open after the answer is taken.
			server(
				{ status: 201, body: { replay: false, message: { delivery: 'delivered' } } },
				view([c, other])
			);
			const sent = inbox.answer(c, 'approve', null, 'token');
			expect(inbox.cards().map((x) => x.id)).toEqual([other.id]);
			expect(inbox.forTask(c.taskId)).toEqual([]);
			expect(inbox.open(Date.now())).toBe(1);
			expect(await sent).toBe(true);
			await vi.runAllTimersAsync();
			// Taken: it stays gone until the server shows it answered or the question closes.
			expect(inbox.cards().map((x) => x.id)).toEqual([other.id]);
			expect(inbox.hasDecision(other.taskId)).toBe(true);
		} finally {
			vi.useRealTimers();
		}
	});

	it('lets a taken answer go once the server shows it, and brings back a new question', async () => {
		vi.useFakeTimers();
		try {
			const c = card();
			inbox.value = view([c]);
			const delivered = {
				choice: 'approve' as const,
				picks: null,
				note: null,
				at: new Date().toISOString(),
				delivery: 'delivered',
				detail: null,
				requestId: 'inbox-1'
			};
			server(
				{ status: 201, body: { replay: false, message: { delivery: 'delivered' } } },
				view([{ ...c, sent: delivered }])
			);
			await inbox.answer(c, 'approve', null, 'token');
			await vi.runAllTimersAsync();
			expect(inbox.pending).toEqual({});
			expect(inbox.shown(Date.now()).shown).toEqual([]);
			// The same question raised again with new words is open again.
			inbox.value = view([{ ...c, question: 'Merge pull request #13? Its checks are green.' }]);
			expect(inbox.shown(Date.now()).shown).toHaveLength(1);
		} finally {
			vi.useRealTimers();
		}
	});

	it('hides a question answered anywhere else (another tab, the phone)', () => {
		const answered = card({
			sent: {
				choice: 'fix',
				picks: null,
				note: null,
				at: new Date().toISOString(),
				delivery: 'saved-unannounced',
				detail: null,
				requestId: 'discord:1'
			}
		});
		inbox.value = view([answered]);
		expect(inbox.shown(Date.now()).shown).toEqual([]);
		expect(inbox.forTask(answered.taskId)).toEqual([]);
		expect(inbox.open(Date.now())).toBe(0);
	});

	it('shows an answer that was uncertain and later failed as not delivered, still open', async () => {
		vi.useFakeTimers();
		try {
			const c = card();
			inbox.value = view([c]);
			const failed = {
				choice: 'approve' as const,
				picks: null,
				note: null,
				at: new Date().toISOString(),
				delivery: 'failed',
				detail: 'Firstmate did not take the message: exit 1',
				requestId: 'inbox-1'
			};
			server(
				{ status: 202, body: { replay: false, message: { delivery: 'uncertain' } } },
				view([{ ...c, sent: failed }])
			);
			expect(await inbox.answer(c, 'approve', null, 'token')).toBe(true);
			await vi.runAllTimersAsync();
			expect(inbox.pending).toEqual({});
			expect(inbox.cards()[0].sent).toEqual(failed);
			expect(inbox.open(Date.now())).toBe(1);
		} finally {
			vi.useRealTimers();
		}
	});
});
