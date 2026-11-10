import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { optionsFor, type InboxCard, type InboxChoices } from '$lib/inbox';
import DecisionCard from './DecisionCard.svelte';

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
		previewTask: null,
		board: null,
		checks: 'green',
		screenshots: []
	},
	options: optionsFor('merge'),
	recommendation: null,
	choices: null,
	sent: null,
	...o
});

let app: ReturnType<typeof mount> | null = null;

afterEach(() => {
	if (app) unmount(app);
	app = null;
	document.body.innerHTML = '';
});

describe('DecisionCard', () => {
	it('shows a failed delivery as not sent, even while the answer error is showing', () => {
		const failed = card({
			sent: {
				choice: 'approve',
				picks: null,
				note: null,
				at: '2026-10-27T10:00:00Z',
				delivery: 'failed',
				detail: 'note refused',
				requestId: 'r1'
			}
		});
		app = mount(DecisionCard, {
			target: document.body,
			props: {
				card: failed,
				error: 'Not delivered to Firstmate: note refused',
				now: Date.parse('2026-10-27T10:01:00Z'),
				onAgree: () => {},
				onLater: () => {}
			}
		});
		flushSync();
		expect(document.body.textContent).not.toContain('Sent to Firstmate');
		expect(document.querySelector('[role="status"]')).toBeNull();
	});

	const closeButtons = () =>
		[...document.querySelectorAll('button')].filter((b) =>
			b.textContent?.trim().startsWith('Close')
		);
	const decision = (o: Partial<InboxCard> = {}) =>
		card({
			id: 'demo-theme:theme-choice',
			kind: 'decision',
			key: 'theme-choice',
			owner: 'firstmate',
			options: optionsFor('decision'),
			...o
		});
	const show = (c: InboxCard, onClose: () => void) => {
		app = mount(DecisionCard, {
			target: document.body,
			props: { card: c, now: 0, onAgree: () => {}, onLater: () => {}, onClose }
		});
		flushSync();
	};

	it('closes a keyed decision', () => {
		let closed = 0;
		show(decision(), () => closed++);
		closeButtons()[0].click();
		expect(closed).toBe(1);
	});

	it('offers no Close on a merge call or a captain hold', () => {
		show(card(), () => {});
		expect(closeButtons()).toHaveLength(0);
		unmount(app!);
		document.body.innerHTML = '';
		show(card({ kind: 'hold', key: 'captain-hold', options: optionsFor('hold') }), () => {});
		expect(closeButtons()).toHaveLength(0);
	});

	const choices: InboxChoices = {
		intro: 'Gateway design calls',
		after: null,
		calls: [
			{
				id: '1',
				number: 1,
				prompt: 'Approach',
				required: true,
				options: [
					{ id: 'A', label: 'A', detail: 'core gateway', recommended: true },
					{ id: 'C', label: 'C', detail: 'Claude Code channels only', recommended: false }
				]
			},
			{
				id: '2',
				number: 2,
				prompt: 'First channel',
				required: true,
				options: [
					{ id: '1', label: 'Discord', detail: null, recommended: false },
					{ id: '2', label: 'Telegram', detail: null, recommended: false }
				]
			}
		]
	};
	const hold = () =>
		card({
			id: 'demo-billing:captain-hold',
			kind: 'hold',
			key: 'captain-hold',
			question: 'Gateway design calls. 1) Approach: A core gateway (recommended) or C …',
			options: optionsFor('hold', true),
			choices
		});

	it('opens the question in the chat and agrees with the recommended option in one tap', () => {
		const agreed: number[] = [];
		app = mount(DecisionCard, {
			target: document.body,
			props: { card: hold(), now: 0, onAgree: () => agreed.push(1), onLater: () => {} }
		});
		flushSync();
		expect(document.querySelector('h3')!.textContent!.trim()).toBe('Gateway design calls');
		// The card's own calls are answered in the chat; here there is no form to fill in.
		expect(document.querySelectorAll('input[type="radio"]')).toHaveLength(0);
		const chat = document.querySelector<HTMLAnchorElement>('a[data-chat-about]')!;
		expect(chat.getAttribute('href')).toBe('/?decision=demo-billing%3Acaptain-hold');
		// Two calls, only one with a recommended option: nothing to agree with in one tap.
		expect(document.querySelector('[data-agree]')).toBeNull();
		unmount(app);
		document.body.innerHTML = '';
		app = mount(DecisionCard, {
			target: document.body,
			props: { card: card(), now: 0, onAgree: () => agreed.push(2) }
		});
		flushSync();
		const agree = document.querySelector<HTMLButtonElement>('[data-agree]')!;
		expect(agree.textContent!.trim()).toBe('Agree: Merge');
		expect(document.body.textContent).toContain('Firstmate recommends: Merge');
		agree.click();
		expect(agreed).toEqual([2]);
	});

	it('shows action keys and Ask me later only where the page offers them', () => {
		const actions = () =>
			[...document.querySelectorAll('[role="group"] a, [role="group"] button')].map((b) =>
				b.textContent!.trim()
			);
		const recommended = card({
			kind: 'hold',
			key: 'captain-hold',
			options: optionsFor('hold'),
			recommendation: { choice: 'approve', text: 'It is ready.' }
		});
		app = mount(DecisionCard, {
			target: document.body,
			props: { card: recommended, shortcuts: true, now: 0, onAgree: () => {}, onLater: () => {} }
		});
		flushSync();
		expect(actions()).toEqual(['Chat about thisEnter', 'Agree: Go aheada', 'Ask me laterl']);
		unmount(app);
		document.body.innerHTML = '';
		app = mount(DecisionCard, {
			target: document.body,
			props: { card: recommended, now: 0, onAgree: () => {} }
		});
		flushSync();
		expect(document.querySelectorAll('kbd')).toHaveLength(0);
		expect(actions()).toEqual(['Chat about this', 'Agree: Go ahead']);
	});

	it('says a question Firstmate is settling is its own, and can still be taken over', () => {
		show(decision(), () => {});
		expect(document.body.textContent).toContain(
			'Firstmate is handling it; yours to take over if you want'
		);
		expect(document.querySelector('a[data-chat-about]')).not.toBeNull();
	});

	it('links the Markdown files a hold reason and its evidence name to the reader', () => {
		app = mount(DecisionCard, {
			target: document.body,
			props: {
				card: card({
					kind: 'hold',
					key: 'captain-hold',
					question: 'Read data/wh-gateway-design/report.md and pick an option.',
					evidence: {
						...card().evidence,
						text: 'Options are in data/wh-gateway-design/options.md'
					},
					options: optionsFor('hold')
				}),
				expanded: true,
				now: Date.parse('2026-10-27T10:01:00Z'),
				onAgree: () => {},
				onLater: () => {}
			}
		});
		flushSync();
		const links = [...document.querySelectorAll('a[data-doc-link]')].map((a) => [
			a.textContent,
			a.getAttribute('href')
		]);
		expect(links).toEqual([
			['data/wh-gateway-design/report.md', '/files?path=data%2Fwh-gateway-design%2Freport.md'],
			['data/wh-gateway-design/options.md', '/files?path=data%2Fwh-gateway-design%2Foptions.md']
		]);
		expect(document.querySelector('h3')?.textContent?.trim()).toBe(
			'Read data/wh-gateway-design/report.md and pick an option.'
		);
	});
});
