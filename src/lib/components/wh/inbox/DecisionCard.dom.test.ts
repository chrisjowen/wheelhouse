import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { optionsFor, type InboxCard } from '$lib/inbox';
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
		findings: [],
		file: null,
		pr: null,
		preview: null,
		checks: 'green',
		screenshots: []
	},
	options: optionsFor('merge'),
	recommendation: null,
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
				onAnswer: () => {},
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
			props: { card: c, now: 0, onAnswer: () => {}, onLater: () => {}, onClose }
		});
		flushSync();
	};

	it('closes a keyed decision, before or after it is answered', () => {
		let closed = 0;
		show(decision(), () => closed++);
		closeButtons()[0].click();
		expect(closed).toBe(1);
		unmount(app!);
		document.body.innerHTML = '';
		show(
			decision({
				sent: {
					choice: 'skip',
					note: null,
					at: '2026-10-27T10:00:00Z',
					delivery: 'delivered',
					detail: null,
					requestId: 'r2'
				}
			}),
			() => closed++
		);
		expect(document.body.textContent).toContain('Sent to Firstmate');
		closeButtons()[0].click();
		expect(closed).toBe(2);
	});

	it('offers no Close on a merge call or a captain hold', () => {
		show(card(), () => {});
		expect(closeButtons()).toHaveLength(0);
		unmount(app!);
		document.body.innerHTML = '';
		show(card({ kind: 'hold', key: 'captain-hold', options: optionsFor('hold') }), () => {});
		expect(closeButtons()).toHaveLength(0);
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
				onAnswer: () => {},
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
