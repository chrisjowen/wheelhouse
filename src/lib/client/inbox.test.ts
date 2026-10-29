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

	it('shows a taken answer as sending, then as the server reads it back', async () => {
		vi.useFakeTimers();
		try {
			const c = card();
			inbox.value = view([c]);
			server(
				{ status: 201, body: { replay: false, message: { delivery: 'delivered' } } },
				view([c])
			);
			expect(await inbox.answer(c, 'approve', null, 'token')).toBe(true);
			expect(inbox.cards()[0].sent).toMatchObject({ choice: 'approve', delivery: 'sending' });
			await vi.runAllTimersAsync();
			// The server does not show it (say it failed later): the card is open again.
			expect(inbox.pending).toEqual({});
			expect(inbox.cards()[0].sent).toBeNull();
		} finally {
			vi.useRealTimers();
		}
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
