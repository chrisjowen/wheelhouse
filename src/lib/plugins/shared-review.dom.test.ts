import { readFileSync } from 'node:fs';
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
	threads: [
		{
			id: 'c1',
			n: 1,
			author: 'Ana',
			at: '2026-11-09T10:01:00Z',
			first: 'Bigger <b>button</b>',
			anchor: { path: '/', label: 'the “Pay now” button' },
			replies: 1,
			unsent: 2
		}
	],
	held: [],
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
		expect(root.textContent).toContain('2 comments');
		expect(root.textContent).toContain('Ana, Ben');
		expect(root.querySelector('a')!.getAttribute('href')).toBe(
			`${DESK}/_review/AbCdEfGhIjKlMnOpQrStUv`
		);
		expect(root.textContent).not.toContain('k7mq-3xrt-h9pd');
		button('Show').click();
		expect(root.textContent).toContain('k7mq-3xrt-h9pd');
		expect(root.textContent).toContain('Live app http://127.0.0.1:5173: connected');
	});

	it('copies the link with its passcode, and shows the review live in a sandboxed frame', async () => {
		const shareLink = `${DESK}/_review/AbCdEfGhIjKlMnOpQrStUv#p=k7mq-3xrt-h9pd`;
		const peeks: unknown[] = [];
		vi.stubGlobal(
			'fetch',
			vi.fn(async (url: string, init?: RequestInit) => {
				const p = new URL(url).pathname;
				if (p.endsWith('/peek')) {
					expect(new Headers(init?.headers).get('x-review-desk-key')).toBe('desk-key');
					peeks.push(JSON.parse(String(init?.body)));
					return Response.json({ url: 'http://localhost:5999/_review/peek/one-time' });
				}
				return new Response('{}', { status: 500 });
			})
		);
		// A frame loads once it is on screen: here, at once.
		vi.stubGlobal(
			'IntersectionObserver',
			class {
				constructor(private cb: IntersectionObserverCallback) {}
				observe(target: Element) {
					this.cb(
						[{ target, isIntersecting: true } as unknown as IntersectionObserverEntry],
						this as unknown as IntersectionObserver
					);
				}
				unobserve() {}
				disconnect() {}
			}
		);
		const copied: string[] = [];
		Object.defineProperty(navigator, 'clipboard', {
			configurable: true,
			value: { writeText: async (v: string) => void copied.push(v) }
		});
		const { el, root, button } = await mount([review({ shareLink })], {});
		await settle();

		// The link reads without the passcode, but opens and copies with it.
		const shown = [...root.querySelectorAll('.linkrow a')][0] as HTMLAnchorElement;
		expect(shown.textContent).toBe(`${DESK}/_review/AbCdEfGhIjKlMnOpQrStUv`);
		expect(shown.getAttribute('href')).toBe(shareLink);
		button('Copy link').click();
		await settle();
		expect(copied).toEqual([shareLink]);

		// The thumbnail opens the review, and its frame is the desk's peek, asked for with the key.
		const thumb = root.querySelector('a.thumb') as HTMLAnchorElement;
		expect(thumb.getAttribute('href')).toBe(shareLink);
		expect(thumb.target).toBe('_blank');
		expect(thumb.querySelector('slot')!.name).toBe('thumb-sr-abc123');
		const frame = el.querySelector('[slot="thumb-sr-abc123"] iframe') as HTMLIFrameElement;
		expect(frame.getAttribute('sandbox')).toBe('allow-scripts allow-same-origin');
		expect(frame.getAttribute('loading')).toBe('lazy');
		expect(frame.tabIndex).toBe(-1);
		expect(frame.getAttribute('src')).toBe('http://localhost:5999/_review/peek/one-time');
		expect(peeks).toEqual([{ origin: location.origin }]);

		// Redrawing keeps the same frame, so it does not load again.
		button('Show').click();
		expect(el.querySelector('[slot="thumb-sr-abc123"] iframe')).toBe(frame);
		expect(peeks).toHaveLength(1);
	});

	it('asks for a thumbnail again on the next redraw when the desk did not answer', async () => {
		let fail = true;
		let asked = 0;
		vi.stubGlobal(
			'fetch',
			vi.fn(async (url: string) => {
				if (new URL(url).pathname.endsWith('/peek')) {
					asked++;
					if (fail) return new Response('{}', { status: 503 });
					return Response.json({ url: 'http://localhost:5999/_review/peek/again' });
				}
				return new Response('{}', { status: 500 });
			})
		);
		vi.stubGlobal(
			'IntersectionObserver',
			class {
				constructor(private cb: IntersectionObserverCallback) {}
				observe(target: Element) {
					this.cb(
						[{ target, isIntersecting: true } as unknown as IntersectionObserverEntry],
						this as unknown as IntersectionObserver
					);
				}
				unobserve() {}
				disconnect() {}
			}
		);
		const { el, button } = await mount([review()], {});
		await settle();
		const frame = el.querySelector('[slot="thumb-sr-abc123"] iframe') as HTMLIFrameElement;
		expect(asked).toBe(1);
		expect(frame.getAttribute('src')).toBeNull();

		fail = false;
		button('Show').click();
		await settle();
		expect(asked).toBe(2);
		expect(el.querySelector('[slot="thumb-sr-abc123"] iframe')).toBe(frame);
		expect(frame.getAttribute('src')).toBe('http://localhost:5999/_review/peek/again');

		button('Hide').click();
		await settle();
		expect(asked).toBe(2);
	});

	it('shows no frame for a closed review', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response('{}', { status: 500 }))
		);
		const closed = review({ state: 'delivered', link: null, passcode: null, feedback: null });
		const { el, root } = await mount([closed], {});
		expect(root.querySelector('.thumb.empty')!.textContent).toContain('Closed');
		expect(el.querySelector('iframe')).toBeNull();
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
			if (p.endsWith('/peek'))
				return Response.json({ url: 'http://127.0.0.1:5999/_review/peek/t' });
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
			'This takes the link down and sends 1 thread to Firstmate, as one note about lumen-checkout'
		);
		button('Close and send 1 thread to Firstmate').click();
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
		button('Close and send 1 thread to Firstmate').click();
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
		button('Close and send 1 thread to Firstmate').click();
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
		button('Close and send 1 thread to Firstmate').click();
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

	describe('choosing which threads go to Firstmate', () => {
		const thread = (id: string, author: string, first: string, path = '/') => ({
			id,
			n: Number(id.slice(1)),
			author,
			at: '2026-11-09T10:01:00Z',
			first,
			anchor: { path, label: `${author}’s spot` },
			replies: 0,
			unsent: 1
		});
		const three = () =>
			review({
				threads: [
					thread('t1', 'Ana', 'Bigger button'),
					thread('t2', 'Ben', 'Hide the promo box', '/cart'),
					thread('t3', 'Cy', 'Wrong total')
				],
				feedback: {
					subject: 'the shared review “Checkout” (3 comments from Ana, Ben and Cy)',
					items: [
						{ text: 'Ana: Bigger button', points: 'a' },
						{ text: 'Ben: Hide the promo box', points: 'b' },
						{ text: 'Cy: Wrong total', points: 'c' }
					],
					ids: ['t1', 't2', 't3']
				}
			});
		const some = {
			subject: 'the shared review “Checkout” (2 comments from Ana and Cy)',
			items: [
				{ text: 'Ana: Bigger button', points: 'a' },
				{ text: 'Cy: Wrong total', points: 'c' }
			],
			ids: ['t1', 't3']
		};
		const closed = review({ state: 'delivered', link: null, passcode: null, feedback: null });

		function desk() {
			const posts: string[] = [];
			vi.stubGlobal(
				'fetch',
				vi.fn(async (url: string, init?: RequestInit) => {
					const p = new URL(url).pathname;
					if (init?.method === 'POST') posts.push(`${p} ${init.body}`);
					if (p.endsWith('/feedback')) return Response.json({ feedback: some });
					if (p.endsWith('/close')) return Response.json({ review: closed, late: null });
					if (p.endsWith('/delivered')) return Response.json({ review: closed });
					return Response.json({ remote: data([]).desk.remote, reviews: [closed] });
				})
			);
			return posts;
		}
		const boxes = (root: ShadowRoot) => [
			...root.querySelectorAll<HTMLInputElement>('input[type=checkbox]')
		];

		it('ticks every thread at first, showing who, where and its first line', async () => {
			desk();
			const { root, button } = await mount([three()], {});
			button('Close…').click();
			expect(boxes(root).map((b) => [b.dataset.thread, b.checked])).toEqual([
				['t1', true],
				['t2', true],
				['t3', true]
			]);
			const labels = [...root.querySelectorAll('.picks label')].map((l) => l.textContent);
			expect(labels[1]).toBe('#2 Ben on Ben’s spot (/cart)Hide the promo box');
			expect(root.textContent).toContain('3 of 3 threads selected');
			expect(button('Close and send 3 threads to Firstmate').disabled).toBe(false);
		});

		it('sends only the ticked threads, and keeps the others back as unsent', async () => {
			const posts = desk();
			const sent: FeedbackList[] = [];
			const { root, button } = await mount([three()], {
				sendFeedback: async (list) => {
					sent.push(list);
					return { ok: true, pending: false };
				}
			});
			button('Close…').click();
			const ben = boxes(root)[1];
			ben.checked = false;
			ben.dispatchEvent(new Event('change'));
			expect(root.textContent).toContain('2 of 3 threads selected');
			expect(root.textContent).toContain(
				'sends 2 of 3 threads to Firstmate, as one note about lumen-checkout, for its worker. The others stay in its bundle on this computer, marked unsent.'
			);
			await settle();
			button('Close and send 2 threads to Firstmate').click();
			await settle();
			expect(sent).toEqual([{ task: 'lumen-checkout', subject: some.subject, items: some.items }]);
			expect(posts).toEqual([
				`/_review/desk/reviews/sr-abc123/feedback {"threads":["t1","t3"]}`,
				`/_review/desk/reviews/sr-abc123/close {"sent":["t1","t3"],"held":["t2"]}`,
				`/_review/desk/reviews/sr-abc123/delivered {}`
			]);
			expect(root.textContent).toContain(
				'Sent to Firstmate, and the link is down. 1 thread not sent is kept in its bundle on this computer.'
			);
		});

		it('sends nothing with no thread ticked, and closes without sending only when asked', async () => {
			const posts = desk();
			const sent: FeedbackList[] = [];
			const { root, button } = await mount([three()], {
				sendFeedback: async (list) => {
					sent.push(list);
					return { ok: true, pending: false };
				}
			});
			button('Close…').click();
			button('Select none').click();
			expect(boxes(root).every((b) => !b.checked)).toBe(true);
			expect(root.textContent).toContain(
				'No threads are selected, so nothing would go to Firstmate.'
			);
			const send = button('Close and send 0 threads to Firstmate');
			expect(send.disabled).toBe(true);
			send.click();
			await settle();
			expect(posts).toEqual([]);

			button('Close without sending').click();
			await settle();
			expect(sent).toEqual([]);
			expect(posts).toEqual([
				`/_review/desk/reviews/sr-abc123/close {}`,
				`/_review/desk/reviews/sr-abc123/delivered {}`
			]);
		});

		it('sends every thread again after Select all, with the desk’s own list', async () => {
			const posts = desk();
			const sent: FeedbackList[] = [];
			const { root, button } = await mount([three()], {
				sendFeedback: async (list) => {
					sent.push(list);
					return { ok: true, pending: false };
				}
			});
			button('Close…').click();
			button('Select none').click();
			button('Select all').click();
			expect(boxes(root).every((b) => b.checked)).toBe(true);
			button('Close and send 3 threads to Firstmate').click();
			await settle();
			expect(sent.map((l) => l.items.length)).toEqual([3]);
			expect(posts[0]).toBe(`/_review/desk/reviews/sr-abc123/close {"sent":["t1","t2","t3"]}`);
		});
	});

	describe('summarising the threads into points before sending', () => {
		const thread = (id: string, author: string, first: string) => ({
			id,
			n: Number(id.slice(1)),
			author,
			at: '2026-11-09T10:01:00Z',
			first,
			anchor: { path: '/', label: `${author}’s spot` },
			replies: 0,
			unsent: 1
		});
		const all = {
			subject: 'the shared review “Checkout” (4 comments from Ana, Ben and Cy)',
			items: [
				{ text: 'Ana: Bigger button — Ben replied: and say the amount', points: 'a' },
				{ text: 'Ben: Hide the promo box', points: 'b' },
				{ text: 'Cy: Wrong total', points: 'c' }
			],
			ids: ['t1', 'r1', 't2', 't3'],
			threads: ['t1', 't2', 't3']
		};
		const three = () =>
			review({
				comments: [
					{
						id: 't1',
						author: 'Ana',
						parent: null,
						body: 'Bigger button',
						anchor: { path: '/', label: 'a' }
					},
					{
						id: 'r1',
						author: 'Ben',
						parent: 't1',
						body: 'and say the amount',
						anchor: { path: '/', label: 'a' }
					},
					{
						id: 't2',
						author: 'Ben',
						parent: null,
						body: 'Hide the promo box',
						anchor: { path: '/', label: 'b' }
					},
					{
						id: 't3',
						author: 'Cy',
						parent: null,
						body: 'Wrong total',
						anchor: { path: '/', label: 'c' }
					}
				],
				threads: [
					{ ...thread('t1', 'Ana', 'Bigger button'), replies: 1, unsent: 2 },
					thread('t2', 'Ben', 'Hide the promo box'),
					thread('t3', 'Cy', 'Wrong total')
				],
				feedback: all
			});
		const points = [
			{
				text: 'Make the Pay now button bigger and show the amount',
				points: 'the “Pay now” button',
				from: [1]
			},
			{ text: 'Hide the promo box behind a link', points: null, from: [2] },
			{ text: 'Fix the total', points: 'the total', from: [3] }
		];
		const closed = review({ state: 'delivered', link: null, passcode: null, feedback: null });

		function desk() {
			const posts: string[] = [];
			vi.stubGlobal(
				'fetch',
				vi.fn(async (url: string, init?: RequestInit) => {
					const p = new URL(url).pathname;
					if (init?.method === 'POST') posts.push(`${p} ${init.body}`);
					if (p.endsWith('/close')) return Response.json({ review: closed, late: null });
					if (p.endsWith('/delivered')) return Response.json({ review: closed });
					return Response.json({ remote: data([]).desk.remote, reviews: [closed] });
				})
			);
			return posts;
		}
		const ticks = (root: ShadowRoot) => [
			...root.querySelectorAll<HTMLInputElement>('input[type=checkbox][data-point]')
		];

		it('summarises the ticked threads, lets the captain edit and pick the points, and sends those', async () => {
			const posts = desk();
			const asked: FeedbackList[] = [];
			const sent: FeedbackList[] = [];
			const { root, button } = await mount([three()], {
				summariseFeedback: async (list) => {
					asked.push(list);
					return { ok: true, points };
				},
				sendFeedback: async (list) => {
					sent.push(list);
					return { ok: true, pending: false };
				}
			});
			button('Close…').click();
			button('Summarise into points').click();
			await settle();
			expect(asked).toEqual([{ task: 'lumen-checkout', subject: all.subject, items: all.items }]);
			expect(root.textContent).toContain('3 of 3 points selected');
			expect(root.textContent).toContain('On the “Pay now” button · from thread #1');
			const boxes = [...root.querySelectorAll<HTMLTextAreaElement>('textarea')];
			expect(boxes.map((b) => b.value)).toEqual(points.map((p) => p.text));

			boxes[0].value = 'Make the Pay now button bigger, with the amount on it';
			boxes[0].dispatchEvent(new Event('input'));
			const promo = ticks(root)[1];
			promo.checked = false;
			promo.dispatchEvent(new Event('change'));
			expect(root.textContent).toContain('2 of 3 points selected');
			// The edit survives the render the tick caused.
			expect(root.querySelector<HTMLTextAreaElement>('textarea')!.value).toBe(
				'Make the Pay now button bigger, with the amount on it'
			);

			button('Close and send 2 points to Firstmate').click();
			await settle();
			expect(sent).toEqual([
				{
					task: 'lumen-checkout',
					subject: all.subject,
					items: [
						{
							text: 'Make the Pay now button bigger, with the amount on it',
							points: 'the “Pay now” button'
						},
						{ text: 'Fix the total', points: 'the total' }
					]
				}
			]);
			// The threads the sent points came from are sent; the promo thread is held, unsent.
			expect(JSON.parse(posts[0].slice(posts[0].indexOf(' ') + 1))).toEqual({
				sent: ['t1', 'r1', 't3'],
				held: ['t2'],
				points: [
					{
						text: 'Make the Pay now button bigger, with the amount on it',
						points: 'the “Pay now” button',
						threads: ['t1']
					},
					{ text: 'Fix the total', points: 'the total', threads: ['t3'] }
				]
			});
			expect(root.textContent).toContain(
				'Sent 2 points to Firstmate, and the link is down. Every comment is kept as it was in its bundle on this computer. 1 thread not sent is kept in its bundle on this computer.'
			);
		});

		it('still sends the threads as they are when the helper cannot summarise', async () => {
			const posts = desk();
			const sent: FeedbackList[] = [];
			const { root, button } = await mount([three()], {
				summariseFeedback: async () => ({
					ok: false,
					error:
						'Claude Code (`claude`) is not installed or not on PATH, so the preview helper cannot answer.'
				}),
				sendFeedback: async (list) => {
					sent.push(list);
					return { ok: true, pending: false };
				}
			});
			button('Close…').click();
			button('Summarise into points').click();
			await settle();
			expect(root.textContent).toContain(
				'The preview helper could not summarise them: Claude Code (`claude`) is not installed or not on PATH, so the preview helper cannot answer. You can still send the threads as they are.'
			);
			expect(root.querySelector('textarea')).toBeNull();
			button('Close and send 3 threads to Firstmate').click();
			await settle();
			expect(sent).toEqual([{ task: 'lumen-checkout', subject: all.subject, items: all.items }]);
			expect(posts[0]).toBe(`/_review/desk/reviews/sr-abc123/close {"sent":["t1","r1","t2","t3"]}`);
		});

		it('puts the points aside when the thread selection changes, and can send the threads instead', async () => {
			desk();
			const { root, button } = await mount([three()], {
				summariseFeedback: async () => ({ ok: true, points })
			});
			button('Close…').click();
			button('Summarise into points').click();
			await settle();
			expect(button('Close and send 3 points to Firstmate')).toBeTruthy();
			button('Send the threads as they are').click();
			expect(root.querySelector('textarea')).toBeNull();
			expect(button('Close and send 3 threads to Firstmate')).toBeTruthy();

			button('Summarise into points').click();
			await settle();
			const cy = root.querySelector<HTMLInputElement>('input[data-thread="t3"]')!;
			cy.checked = false;
			cy.dispatchEvent(new Event('change'));
			expect(root.querySelector('textarea')).toBeNull();
			expect(root.textContent).toContain(
				'The selection changed, so the points made before were put aside'
			);
		});

		it('offers no summary when the page cannot make one', async () => {
			desk();
			const { root, button } = await mount([three()], {});
			button('Close…').click();
			expect(root.textContent).not.toContain('Summarise into points');
		});
	});
});

describe('the review’s sign-in page, opened from a link', () => {
	const REVIEW = path.resolve('plugins/shared-review/review');
	const script = readFileSync(path.join(REVIEW, 'assets/passcode.js'), 'utf8');

	async function open(address: string) {
		const { signInPage } = await import(pathToFileURL(path.join(REVIEW, 'pages.mjs')).href);
		const html: string = signInPage({
			rid: 'AbCdEfGhIjKlMnOpQrStUv',
			title: 'Checkout',
			methods: ['passcode']
		});
		document.body.innerHTML = /<body[^>]*>([\s\S]*)<\/body>/.exec(html)![1];
		history.replaceState(null, '', address);
		new Function(script)();
		const form = document.getElementById('passcode-form') as HTMLFormElement;
		return {
			form,
			passcode: document.getElementById('passcode') as HTMLInputElement,
			field: document.getElementById('passcode-field')!,
			note: document.getElementById('passcode-from-link')!
		};
	}

	it('takes the passcode out of the address at once, and fills it in for the reviewer', async () => {
		const { form, passcode, field, note } = await open(
			'/_review/AbCdEfGhIjKlMnOpQrStUv?x=1#p=k7mq-3xrt-h9pd'
		);
		expect(location.hash).toBe('');
		expect(location.href).not.toContain('k7mq');
		expect(location.pathname + location.search).toBe('/_review/AbCdEfGhIjKlMnOpQrStUv?x=1');
		expect(passcode.value).toBe('k7mq-3xrt-h9pd');
		expect(field.hidden).toBe(true);
		expect(note.hidden).toBe(false);
		// It is posted with the reviewer's name, as a typed one is.
		(form.querySelector('input[name="name"]') as HTMLInputElement).value = 'Ana';
		expect(Object.fromEntries(new FormData(form))).toEqual({
			method: 'passcode',
			name: 'Ana',
			passcode: 'k7mq-3xrt-h9pd'
		});
	});

	it('decodes a passcode the link encoded', async () => {
		const { passcode } = await open(
			`/_review/AbCdEfGhIjKlMnOpQrStUv#p=${encodeURIComponent('a b&c')}`
		);
		expect(passcode.value).toBe('a b&c');
		expect(location.hash).toBe('');
	});

	it('leaves the page as it was for a link without one: the reviewer types it', async () => {
		const { passcode, field, note } = await open('/_review/AbCdEfGhIjKlMnOpQrStUv');
		expect(passcode.value).toBe('');
		expect(field.hidden).toBe(false);
		expect(note.hidden).toBe(true);
		expect(location.pathname).toBe('/_review/AbCdEfGhIjKlMnOpQrStUv');
	});
});

describe('comments beyond one spot, in the task section', () => {
	it('shows whole-review comments and attachments, and lets the captain delete a comment', async () => {
		const calls: [string, string][] = [];
		vi.stubGlobal(
			'fetch',
			vi.fn(async (url: string, init?: RequestInit) => {
				calls.push([init?.method ?? 'GET', String(url)]);
				return new Response(JSON.stringify({ ok: true, removed: ['g1'], reviews: [] }), {
					status: 200
				});
			})
		);
		const { root, button } = await mount(
			[
				review({
					comments: [
						{
							id: 'g1',
							author: 'Ana',
							email: null,
							at: '2026-11-09T10:01:00Z',
							editedAt: '2026-11-09T10:03:00Z',
							body: '',
							parent: null,
							general: true,
							anchor: null,
							attachments: [
								{
									name: 'shot<b>.png',
									type: 'image/png',
									size: 2048,
									kind: 'image',
									seconds: null
								},
								{
									name: 'voice-note.webm',
									type: 'audio/webm',
									size: 9000,
									kind: 'voice',
									seconds: 75
								}
							]
						}
					],
					threads: [
						{
							id: 'g1',
							n: 1,
							author: 'Ana',
							at: '2026-11-09T10:01:00Z',
							first: '[attached: shot.png (2 KB); voice note, 1:15]',
							anchor: null,
							replies: 0,
							unsent: 1
						}
					],
					people: ['Ana']
				})
			],
			{}
		);
		expect(root.textContent).toContain('Ana on the whole review');
		expect(root.textContent).toContain('edited');
		expect(root.textContent).toContain('Attached: shot<b>.png (2 KB), voice note 1:15');
		expect(root.querySelector('b')).toBeNull();
		// The Close dialog names a whole-review thread as such.
		button('Close…').click();
		expect(root.querySelector('.picks label')!.textContent).toBe(
			'#1 Ana on the whole review[attached: shot.png (2 KB); voice note, 1:15]'
		);
		button('Cancel').click();
		button('Delete').click();
		expect(root.textContent).toContain('Delete this comment and its replies?');
		expect(calls.filter(([m]) => m === 'DELETE')).toEqual([]);
		button('Keep it').click();
		button('Delete').click();
		[...root.querySelectorAll('button')].filter((b) => b.textContent === 'Delete')[0].click();
		await settle();
		expect(calls).toContainEqual(['DELETE', `${DESK}/_review/desk/reviews/sr-abc123/comments/g1`]);
	});
});
