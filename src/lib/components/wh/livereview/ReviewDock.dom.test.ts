import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
	page: { data: { sessionToken: 't', features: { livereview: true } } as Record<string, unknown> }
}));
vi.mock('$app/state', () => state);

const { default: ReviewDock } = await import('./ReviewDock.svelte');

/*
 * The live review's panel on the page under review. In the test the page and
 * the panel are one window: what the panel tells the page is caught at
 * postMessage, and what the page tells the panel is a message event from it.
 */
const FROM = 'http://127.0.0.1:5999';
let app: ReturnType<typeof mount> | null = null;
let told: Record<string, unknown>[] = [];

const open = () => {
	app = mount(ReviewDock, {
		target: document.body,
		props: {
			taskId: 'lumen-signup',
			title: 'Lumen shop',
			preview: 'http://127.0.0.1:4418/',
			from: FROM,
			back: '/?thread=lumen'
		}
	});
	flushSync();
};
const close = () => {
	if (app) unmount(app);
	app = null;
	document.body.innerHTML = '';
};
const fromPage = (data: Record<string, unknown>) => {
	window.dispatchEvent(
		new MessageEvent('message', { data: { __wh: 1, ...data }, origin: FROM, source: window })
	);
	flushSync();
};
const button = (text: string) =>
	[...document.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
		b.textContent?.includes(text)
	)!;
const lastState = () => told.filter((m) => m.type === 'state').at(-1);

const SUBSCRIPTIONS = {
	label: 'the “Subscriptions” link',
	tag: 'a',
	text: 'Subscriptions',
	secret: false,
	selector: 'nav > a:nth-of-type(2)',
	rect: { x: 10, y: 10, w: 80, h: 20 }
};

beforeEach(() => {
	told = [];
	sessionStorage.clear();
	vi.spyOn(window, 'postMessage').mockImplementation((m: unknown) => {
		told.push(m as Record<string, unknown>);
	});
	vi.stubGlobal(
		'fetch',
		vi.fn(async () => new Response(JSON.stringify({ message: 'No scribe here.' }), { status: 503 }))
	);
});
afterEach(() => {
	close();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe('ReviewDock', () => {
	it('records nothing at first: it offers Comment and Start live discussion, and the way back', () => {
		open();
		expect(told[0]).toMatchObject({ type: 'ready' });
		expect(lastState()).toMatchObject({ recording: false, comments: 0, canDone: false });
		expect(button('Comment')).toBeTruthy();
		expect(button('Start live discussion')).toBeTruthy();
		expect(document.querySelector('[data-review-done]')).toBeNull();
		const back = document.querySelector<HTMLAnchorElement>('[data-review-back]')!;
		expect(back.getAttribute('href')).toBe('/?thread=lumen');
		expect(back.target).toBe('_top');
	});

	it('takes a comment on the part the captain picked, and offers Done', () => {
		open();
		button('Comment').click();
		flushSync();
		expect(told.some((m) => m.type === 'pick' && m.on === true)).toBe(true);
		fromPage({ type: 'picked', el: SUBSCRIPTIONS, url: `${FROM}/` });
		expect(document.querySelector('[data-review-comment]')?.textContent).toContain(
			'On the “Subscriptions” link'
		);
		const box = document.querySelector<HTMLTextAreaElement>('textarea')!;
		box.value = 'Should say coming soon.';
		box.dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
		button('Add comment').click();
		flushSync();
		expect(lastState()).toMatchObject({ recording: false, comments: 1, canDone: true });
		expect(document.querySelector('[data-review-done]')).not.toBeNull();
		expect(document.body.textContent).toContain('Should say coming soon.');
	});

	it('records only once a discussion starts, and Done on the page’s button makes the pack', async () => {
		open();
		button('Start live discussion').click();
		flushSync();
		expect(told.some((m) => m.type === 'record' && m.on === true)).toBe(true);
		expect(lastState()).toMatchObject({ recording: true, canDone: true });
		const input = document.querySelector<HTMLInputElement>(
			'input[aria-label="Type to the scribe"]'
		)!;
		input.value = 'The cart badge is too small.';
		input.dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
		input.form!.requestSubmit();
		flushSync();
		fromPage({ type: 'done' });
		await vi.waitFor(() => expect(document.querySelector('[data-review-pack]')).not.toBeNull());
		expect(told.some((m) => m.type === 'panel' && m.large === true)).toBe(true);
		expect(lastState()).toMatchObject({ pack: true });
		// The pack slides in; let it finish before the panel goes.
		await new Promise((r) => setTimeout(r, 450));
	});

	it('talks while Space is held for 2 seconds over the panel, and a short press is only a Space', () => {
		vi.useFakeTimers();
		try {
			open();
			button('Start live discussion').click();
			flushSync();
			// The shared push to talk listens while the pointer is over the panel.
			document.querySelector('[data-review-dock]')!.dispatchEvent(new PointerEvent('pointerenter'));
			const key = (type: 'keydown' | 'keyup') =>
				document.body.dispatchEvent(
					new KeyboardEvent(type, { code: 'Space', key: ' ', bubbles: true, cancelable: true })
				);
			key('keydown');
			vi.advanceTimersByTime(800);
			key('keyup');
			flushSync();
			expect(lastState()).toMatchObject({ talking: false });
			key('keydown');
			vi.advanceTimersByTime(2000);
			flushSync();
			expect(lastState()).toMatchObject({ talking: true });
			key('keyup');
			flushSync();
			expect(lastState()).toMatchObject({ talking: false });
		} finally {
			vi.useRealTimers();
		}
	});

	it('talks when the page says Space was held there', () => {
		open();
		button('Start live discussion').click();
		flushSync();
		fromPage({ type: 'key', key: 'talk', down: true });
		expect(lastState()).toMatchObject({ talking: true });
		fromPage({ type: 'key', key: 'talk', down: false });
		expect(lastState()).toMatchObject({ talking: false });
	});

	it('marks areas while recording: the page dims, and each area joins the timeline', () => {
		open();
		expect(document.querySelector('[data-review-mark]')).toBeNull();
		button('Start live discussion').click();
		flushSync();
		const mark = document.querySelector<HTMLButtonElement>('[data-review-mark]')!;
		mark.click();
		flushSync();
		expect(told.some((m) => m.type === 'mark' && m.on === true)).toBe(true);
		expect(mark.getAttribute('aria-pressed')).toBe('true');
		fromPage({ type: 'area', rect: { x: 10, y: 20, w: 200, h: 100 }, n: 1, url: `${FROM}/` });
		const timeline = told.filter((m) => m.type === 'timeline').at(-1) as {
			items: { kind: string }[];
		};
		expect(timeline.items.map((i) => i.kind)).toContain('mark');
		// The page left marking (Esc there): the panel follows.
		fromPage({ type: 'marking', on: false });
		expect(mark.getAttribute('aria-pressed')).toBe('false');
	});

	it('starts on a phone’s Record with the mic on, and its Stop ends the session', () => {
		open();
		fromPage({ type: 'quick' });
		expect(lastState()).toMatchObject({ recording: true, talking: true });
		fromPage({ type: 'quick' });
		expect(lastState()).toMatchObject({ recording: false });
		expect(told.some((m) => m.type === 'areas' && m.clear === true)).toBe(true);
	});

	it('lets the scribe answer out loud or in text only', () => {
		open();
		const text = document.querySelector<HTMLButtonElement>('[data-review-voice="off"]')!;
		text.click();
		flushSync();
		expect(text.getAttribute('aria-pressed')).toBe('true');
		expect(document.querySelector('[data-review-voice="on"]')!.getAttribute('aria-pressed')).toBe(
			'false'
		);
	});

	it('carries on with the session when the page loads again', async () => {
		open();
		button('Comment').click();
		flushSync();
		fromPage({ type: 'picked', el: SUBSCRIPTIONS, url: `${FROM}/` });
		const box = document.querySelector<HTMLTextAreaElement>('textarea')!;
		box.value = 'Kept across a reload.';
		box.dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
		button('Add comment').click();
		flushSync();
		await vi.waitFor(() =>
			expect(sessionStorage.getItem('wh-live-review:lumen-signup')).toContain('Kept across')
		);
		close();
		open();
		expect(document.body.textContent).toContain('Kept across a reload.');
		expect(lastState()).toMatchObject({ comments: 1 });
	});
});
