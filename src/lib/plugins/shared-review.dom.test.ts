import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountElement, type FeedbackList, type PluginHost } from './elements';
import type { SlotEntry } from './types';

/**
 * The bundled Shared review plugin's task section, its <shared-review-task>
 * element: what it shows of a review, and that closing one sends the comments
 * to Firstmate first, on the captain's click, and only then takes the link
 * down through the review desk.
 */

const BUNDLE = pathToFileURL(path.resolve('plugins/shared-review/wheelhouse/ui/index.js')).href;
const DESK = 'http://127.0.0.1:4317';

const entry: SlotEntry = {
	key: 'shared-review/review',
	slot: 'task.section',
	pluginId: 'shared-review',
	contributionId: 'review',
	title: 'Shared review',
	order: 40,
	step: null,
	projectId: 'lumen',
	taskId: 'lumen-checkout',
	render: { element: 'shared-review-task' },
	ui: BUNDLE,
	badge: null,
	content: { available: true, value: null, source: 'a test', observedAt: null }
};

const feedback = {
	subject: 'the shared review “Checkout” (2 comments from Ana and Ben)',
	items: [
		{
			text: 'Ana: Bigger <b>button</b> — Ben replied: Agreed',
			points: 'the “Pay now” button on / (50% across, 50% down it)'
		}
	],
	ids: ['c1', 'c2']
};

const late = {
	subject: 'the shared review “Checkout” (1 comment from Cy)',
	items: [{ text: 'Cy: One more', points: 'a spot on / ' }],
	ids: ['c3']
};

const review = (o: Record<string, unknown> = {}) => ({
	id: 'sr-abc123',
	task: 'lumen-checkout',
	project: 'lumen',
	title: 'Checkout <script>',
	where: 'local',
	server: DESK,
	state: 'open',
	link: `${DESK}/_review/AbCdEfGhIjKlMnOpQrStUv`,
	passcode: 'k7mq-3xrt-h9pd',
	share: { signIn: ['passcode'], invitees: [] },
	source: { kind: 'live', url: 'http://127.0.0.1:5173', start: '/' },
	tunnel: 'connected',
	createdAt: '2026-11-09T10:00:00Z',
	liveAt: null,
	closedAt: null,
	deliveredAt: null,
	sent: false,
	bundleFile: null,
	comments: [
		{
			id: 'c1',
			author: 'Ana',
			email: null,
			at: '2026-11-09T10:01:00Z',
			body: 'Bigger <b>button</b>',
			parent: null,
			anchor: { path: '/', label: 'the “Pay now” button' }
		},
		{
			id: 'c2',
			author: 'Ben',
			email: null,
			at: '2026-11-09T10:02:00Z',
			body: 'Agreed',
			parent: 'c1',
			anchor: { path: '/', label: 'the “Pay now” button' }
		}
	],
	people: ['Ana', 'Ben'],
	feedback,
	problem: null,
	...o
});

const data = (reviews: unknown[]) => ({
	desk: {
		url: DESK,
		key: 'desk-key',
		version: '0.1.0',
		remote: { url: null, state: 'off', reason: 'No review server is set.', signIn: [] }
	},
	deskProblem: null,
	service: 'desk',
	settings: {
		reviewServer: null,
		signIn: ['passcode'],
		invite: [],
		ownerToken: 'SHARED_REVIEW_OWNER_TOKEN',
		reviewHost: null,
		emailFrom: null,
		problems: []
	},
	cli: '/wheelhouse/plugins/shared-review/review/main.mjs',
	deploy: { ssh: 'ssh-deploy.sh', kubernetes: 'kubernetes.yaml', readme: 'README.md' },
	reviews,
	readAt: 0,
	task: {
		id: 'lumen-checkout',
		title: 'Checkout page',
		project: 'lumen',
		preview: 'http://127.0.0.1:5173/',
		worktree: null
	}
});

afterEach(() => {
	vi.unstubAllGlobals();
});

async function mount(reviews: unknown[], host: Partial<PluginHost>) {
	const box = document.createElement('div');
	document.body.append(box);
	const el = await mountElement(box, {
		tag: 'shared-review-task',
		ui: BUNDLE,
		data: data(reviews),
		entry,
		host: {
			pluginId: 'shared-review',
			service: async () => null,
			launch: async () => null,
			sendFeedback: async () => ({ ok: true, pending: false }),
			...host
		} as PluginHost
	});
	const root = el.shadowRoot!;
	const button = (label: string) => {
		const b = [...root.querySelectorAll('button')].find((x) => x.textContent === label);
		if (!b)
			throw new Error(
				`no button ${label}: ${[...root.querySelectorAll('button')].map((x) => x.textContent).join(', ')}`
			);
		return b;
	};
	return { el, root, button };
}

const settle = () => new Promise((r) => setTimeout(r, 20));

describe('the Shared review task section', () => {
	it('shows a review’s link, passcode on request and comments, all as text', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response('{}', { status: 500 }))
		);
		const { root, button } = await mount([review()], {});
		expect(root.querySelector('h3')!.textContent).toBe('Checkout <script>');
		expect(root.querySelector('script')).toBeNull();
		expect(root.querySelector('b')).toBeNull();
		expect(root.textContent).toContain('Bigger <b>button</b>');
		expect(root.textContent).toContain('2 comments from Ana, Ben');
		expect(root.querySelector('a')!.getAttribute('href')).toBe(
			`${DESK}/_review/AbCdEfGhIjKlMnOpQrStUv`
		);
		expect(root.textContent).not.toContain('k7mq-3xrt-h9pd');
		button('Show').click();
		expect(root.textContent).toContain('k7mq-3xrt-h9pd');
		expect(root.textContent).toContain('Live app http://127.0.0.1:5173: connected');
	});

	it('sends the comments to Firstmate first, then takes the link down', async () => {
		const order: string[] = [];
		const sent: FeedbackList[] = [];
		const closed = review({
			state: 'delivered',
			sent: true,
			link: null,
			passcode: null,
			feedback: null
		});
		const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
			const p = new URL(url).pathname;
			order.push(`${init?.method ?? 'GET'} ${p} ${init?.body ?? ''}`.trim());
			expect(new Headers(init?.headers).get('x-review-desk-key')).toBe('desk-key');
			if (p.endsWith('/close')) return Response.json({ review: closed, late: null });
			if (p.endsWith('/delivered')) return Response.json({ review: closed });
			return Response.json({ remote: data([]).desk.remote, reviews: [closed] });
		});
		vi.stubGlobal('fetch', fetchMock);
		const { root, button } = await mount([review()], {
			sendFeedback: async (list) => {
				order.push('feedback');
				sent.push(list);
				return { ok: true, pending: false };
			}
		});
		button('Close…').click();
		expect(root.textContent).toContain(
			'This takes the link down and sends 2 comments to Firstmate, as one note about lumen-checkout'
		);
		button('Close and send to Firstmate').click();
		await settle();
		expect(sent).toEqual([
			{ task: 'lumen-checkout', subject: feedback.subject, items: feedback.items }
		]);
		expect(order).toEqual([
			'feedback',
			`POST /_review/desk/reviews/sr-abc123/close {"sent":["c1","c2"]}`,
			`POST /_review/desk/reviews/sr-abc123/delivered {}`,
			'GET /_review/desk/state'
		]);
		expect(root.textContent).toContain('Sent to Firstmate, and the link is down.');
		expect(root.textContent).toContain('Closed, sent to Firstmate');
	});

	it('closes nothing when Firstmate does not take the list, and offers to close without sending', async () => {
		const fetchMock = vi.fn(async () => Response.json({}));
		vi.stubGlobal('fetch', fetchMock);
		const { root, button } = await mount([review()], {
			sendFeedback: async () => ({ ok: false, error: 'Wheelhouse knows no task lumen-checkout.' })
		});
		button('Close…').click();
		button('Close and send to Firstmate').click();
		await settle();
		expect(fetchMock).not.toHaveBeenCalled();
		expect(root.textContent).toContain(
			'Nothing was sent or closed: Wheelhouse knows no task lumen-checkout.'
		);
		expect(button('Close without sending')).toBeTruthy();
	});

	it('offers to send comments that came in while the review was closing', async () => {
		const sent: FeedbackList[] = [];
		const posts: string[] = [];
		const closed = review({
			state: 'closed',
			sent: true,
			link: null,
			passcode: null,
			feedback: late
		});
		vi.stubGlobal(
			'fetch',
			vi.fn(async (url: string, init?: RequestInit) => {
				const p = new URL(url).pathname;
				if (init?.method === 'POST') posts.push(`${p} ${init.body}`);
				if (p.endsWith('/close')) return Response.json({ review: closed, late });
				if (p.endsWith('/delivered'))
					return Response.json({ review: { ...closed, state: 'delivered', feedback: null } });
				return Response.json({ remote: data([]).desk.remote, reviews: [closed] });
			})
		);
		const { root, button } = await mount([review()], {
			sendFeedback: async (list) => {
				sent.push(list);
				return { ok: true, pending: false };
			}
		});
		button('Close…').click();
		button('Close and send to Firstmate').click();
		await settle();
		expect(root.textContent).toContain('1 comment came in after the others were sent.');
		button('Send them to Firstmate').click();
		await settle();
		expect(sent.map((l) => l.items.map((i) => i.text))).toEqual([
			['Ana: Bigger <b>button</b> — Ben replied: Agreed'],
			['Cy: One more']
		]);
		expect(posts).toEqual([
			`/_review/desk/reviews/sr-abc123/close {"sent":["c1","c2"]}`,
			`/_review/desk/reviews/sr-abc123/delivered {"sent":["c3"]}`
		]);
	});

	it('offers only the comments Firstmate lacks when it is shown a closed review again', async () => {
		const sent: FeedbackList[] = [];
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => Response.json({ remote: data([]).desk.remote, reviews: [] }))
		);
		const closed = review({
			state: 'closed',
			sent: true,
			link: null,
			passcode: null,
			feedback: late
		});
		const { root, button } = await mount([closed], {
			sendFeedback: async (list) => {
				sent.push(list);
				return { ok: true, pending: false };
			}
		});
		expect(root.textContent).toContain('1 comment came in after the others were sent.');
		expect(root.textContent).not.toContain('have not reached Firstmate yet');
		button('Send them to Firstmate').click();
		await settle();
		expect(sent).toEqual([{ task: 'lumen-checkout', subject: late.subject, items: late.items }]);
	});

	it('offers to take a closed review’s comments off the server when the last step failed', async () => {
		const posts: string[] = [];
		let purgeFails = true;
		const closed = review({
			state: 'closed',
			sent: true,
			link: null,
			passcode: null,
			feedback: null
		});
		vi.stubGlobal(
			'fetch',
			vi.fn(async (url: string, init?: RequestInit) => {
				const p = new URL(url).pathname;
				if (init?.method === 'POST') posts.push(`${p} ${init.body}`);
				if (p.endsWith('/close')) return Response.json({ review: closed, late: null });
				if (p.endsWith('/delivered')) {
					if (purgeFails)
						return Response.json({ error: 'The review server did not answer.' }, { status: 502 });
					return Response.json({ review: { ...closed, state: 'delivered' } });
				}
				return Response.json({
					remote: data([]).desk.remote,
					reviews: [purgeFails ? closed : { ...closed, state: 'delivered' }]
				});
			})
		);
		const { root, button } = await mount([review()], {});
		button('Close…').click();
		button('Close and send to Firstmate').click();
		await settle();
		expect(root.textContent).toContain('still on the review server');
		expect(root.textContent).not.toContain('Send to Firstmate');

		purgeFails = false;
		button('Take its comments off the review server').click();
		await settle();
		expect(posts).toEqual([
			`/_review/desk/reviews/sr-abc123/close {"sent":["c1","c2"]}`,
			`/_review/desk/reviews/sr-abc123/delivered {}`,
			`/_review/desk/reviews/sr-abc123/delivered {}`
		]);
		expect(root.textContent).toContain('Its comments are off the review server.');
		expect(root.textContent).not.toContain('Take its comments off');
	});

	it('lets a review closed without sending come off the server without sending its comments', async () => {
		const posts: string[] = [];
		const sent: FeedbackList[] = [];
		const closed = review({ state: 'closed', sent: false, link: null, passcode: null, feedback });
		vi.stubGlobal(
			'fetch',
			vi.fn(async (url: string, init?: RequestInit) => {
				const p = new URL(url).pathname;
				if (init?.method === 'POST') posts.push(`${p} ${init.body}`);
				if (p.endsWith('/delivered'))
					return Response.json({ review: { ...closed, state: 'delivered', feedback: null } });
				return Response.json({
					remote: data([]).desk.remote,
					reviews: [{ ...closed, state: 'delivered', feedback: null }]
				});
			})
		);
		const { root, button } = await mount([closed], {
			sendFeedback: async (list) => {
				sent.push(list);
				return { ok: true, pending: false };
			}
		});
		expect(button('Send to Firstmate')).toBeTruthy();
		button('Take its comments off without sending').click();
		await settle();
		expect(sent).toEqual([]);
		expect(posts).toEqual([`/_review/desk/reviews/sr-abc123/delivered {}`]);
		expect(root.textContent).toContain('Its comments are off the review server.');
		expect(root.textContent).not.toContain('Send to Firstmate');
	});
});
