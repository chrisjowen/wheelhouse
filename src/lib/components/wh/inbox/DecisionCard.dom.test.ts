import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { inbox } from '$lib/client/inbox.svelte';
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
	title: 'Merge pull request #12? Its checks are green.',
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
		checks: 'green',
		screenshots: [],
		docs: []
	},
	options: optionsFor('merge'),
	recommendation: null,
	choices: null,
	sent: null,
	...o
});

let app: ReturnType<typeof mount> | null = null;

let answer: ReturnType<typeof vi.spyOn>;
let follow: ReturnType<typeof vi.spyOn>;
// A link the card follows stays on this page.
const stay = (e: Event) => {
	if ((e.target as Element).closest('a')) e.preventDefault();
};
beforeEach(() => {
	answer = vi.spyOn(inbox, 'answer').mockResolvedValue(true);
	follow = vi.spyOn(inbox, 'follow').mockResolvedValue(true);
	document.addEventListener('click', stay);
});
afterEach(() => {
	if (app) unmount(app);
	app = null;
	document.body.innerHTML = '';
	document.removeEventListener('click', stay);
	vi.restoreAllMocks();
});

const show = (c: InboxCard, more: Record<string, unknown> = {}) => {
	if (app) unmount(app);
	document.body.innerHTML = '';
	app = mount(DecisionCard, { target: document.body, props: { card: c, now: 0, ...more } });
	flushSync();
};
const button = (text: string) =>
	[...document.querySelectorAll('button')].find((b) => b.textContent?.trim().startsWith(text))!;

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
		show(failed, {
			error: 'Not delivered to Firstmate: note refused',
			now: Date.parse('2026-10-27T10:01:00Z'),
			onLater: () => {}
		});
		expect(document.body.textContent).not.toContain('Sent to Firstmate');
		expect(document.querySelector('[role="status"]')).toBeNull();
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
			}
		]
	};
	const hold = (o: Partial<InboxCard> = {}) =>
		card({
			id: 'fm-inbox-fix-call:captain-hold',
			taskId: 'fm-inbox-fix-call',
			taskTitle: 'Inbox-note fix',
			kind: 'hold',
			key: 'fm-inbox-fix-call',
			question: 'Gateway design calls. 1) Approach: A core gateway (recommended) or C …',
			title: 'Which gateway approach?',
			origin: 'fm-inbox-branch-bug',
			options: optionsFor('hold', true),
			choices,
			...o
		});

	it('heads a held decision with its short question, and links its task and where it came from', () => {
		show(hold());
		expect(document.querySelector('h3')!.textContent!.trim()).toBe('Which gateway approach?');
		const task = document.querySelector<HTMLAnchorElement>('a[data-decision-task]')!;
		expect(task.getAttribute('href')).toBe('/tasks/fm-inbox-fix-call');
		expect(task.textContent).toContain('Task');
		expect(task.textContent).toContain('fm-inbox-fix-call');
		const from = document.querySelector<HTMLAnchorElement>('a[data-decision-origin]')!;
		expect(from.getAttribute('href')).toBe('/tasks/fm-inbox-branch-bug');
		// Firstmate's own words and the id sit under Details, folded.
		expect(document.body.textContent).not.toContain('Gateway design calls. 1)');
		expect(document.querySelector('[data-details-panel]')).toBeNull();
	});

	it('answers from its own form, the recommended option first, or in the captain’s own words', () => {
		show(hold(), { canAnswer: true });
		const radios = [...document.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
		expect(radios.map((r) => r.value)).toEqual(['A', 'C', 'other']);
		expect(radios[0].checked).toBe(true);
		radios[2].click();
		flushSync();
		const own = document.querySelector<HTMLTextAreaElement>('textarea[data-other-text]')!;
		own.value = 'Neither: wait for the cloud gateway';
		own.dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
		document.querySelector<HTMLButtonElement>('[data-decide]')!.click();
		expect(answer).toHaveBeenCalledWith(
			expect.objectContaining({ id: 'fm-inbox-fix-call:captain-hold' }),
			'approve',
			null,
			'',
			null,
			'Neither: wait for the cloud gateway'
		);
	});

	it('offers Other on a two-answer card too', () => {
		show(card());
		button('Other').click();
		flushSync();
		expect(document.querySelector('textarea[data-other-text]')).not.toBeNull();
	});

	it('dismisses any question with a reason, a held one and a merge call included', () => {
		for (const c of [hold(), card()]) {
			show(c);
			expect(document.querySelector('[data-dismiss-picker]')).toBeNull();
			document.querySelector<HTMLButtonElement>('button[data-dismiss]')!.click();
			flushSync();
			const reasons = [...document.querySelectorAll('[data-dismiss-picker] label')].map((l) =>
				l.textContent!.trim()
			);
			expect(reasons).toEqual([
				'No longer needed',
				'Already sorted elsewhere',
				'Wrong question',
				'Another reason'
			]);
			document.querySelectorAll<HTMLInputElement>('[data-dismiss-picker] input')[1].click();
			flushSync();
			document.querySelector<HTMLButtonElement>('[data-dismiss-confirm]')!.click();
			flushSync();
			expect(answer).toHaveBeenLastCalledWith(
				expect.objectContaining({ id: c.id }),
				'close',
				'Already sorted elsewhere',
				''
			);
		}
	});

	it('opens Chat with Firstmate about this in the main chat, and keeps it as followed up', () => {
		show(hold());
		const chat = document.querySelector<HTMLAnchorElement>('a[data-chat-about]')!;
		const href = new URL(chat.getAttribute('href')!, 'http://wh.test');
		expect(href.pathname).toBe('/');
		expect(href.searchParams.get('chat')).toBe('fm-inbox-fix-call');
		expect(href.searchParams.get('draft')).toBe(
			'About decision fm-inbox-fix-call (“Which gateway approach?”), not an answer yet: '
		);
		chat.click();
		expect(follow).toHaveBeenCalledWith(
			expect.objectContaining({ taskId: 'fm-inbox-fix-call' }),
			true,
			''
		);
	});

	it('shows a decision followed up with Firstmate as such, and puts it back to waiting', () => {
		show(hold({ following: '2026-11-15T10:00:00Z' }));
		expect(document.querySelector('[data-following]')).not.toBeNull();
		expect(document.body.textContent).toContain('Following up with Firstmate separately');
		expect(document.body.textContent).not.toContain('Waiting on you');
		document.querySelector<HTMLButtonElement>('[data-unfollow]')!.click();
		expect(follow).toHaveBeenCalledWith(
			expect.objectContaining({ taskId: 'fm-inbox-fix-call' }),
			false,
			''
		);
	});

	it('shows action keys and Ask me later only where the page offers them', () => {
		const actions = () =>
			[...document.querySelectorAll('[aria-label="More"] a, [aria-label="More"] button')].map((b) =>
				b.textContent!.trim()
			);
		show(hold(), { shortcuts: true, onLater: () => {} });
		expect(actions()).toEqual(['Chat with Firstmate about thisc', 'Ask me laterl', 'Dismissd']);
		show(hold());
		expect(document.querySelectorAll('[aria-label="More"] kbd')).toHaveLength(0);
		expect(actions()).toEqual(['Chat with Firstmate about this', 'Dismiss']);
	});

	it('says a question Firstmate is settling is its own, and can still be taken over', () => {
		show(
			card({
				id: 'demo-theme:theme-choice',
				kind: 'decision',
				key: 'theme-choice',
				owner: 'firstmate',
				options: optionsFor('decision')
			})
		);
		expect(document.body.textContent).toContain(
			'Firstmate is handling it; yours to take over if you want'
		);
		expect(document.querySelector('a[data-chat-about]')).not.toBeNull();
	});

	it('lists the documents it rests on, each read in a closable reader, and thumbnails its screenshots', async () => {
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('--- a\n+++ b\n+added line'));
		show(
			hold({
				evidence: {
					...card().evidence,
					screenshots: [{ name: 'home.png', url: '/api/files?path=home.png' }],
					docs: [
						{ path: 'data/fm-inbox-branch-bug/report.md', kind: 'report', url: '/r?1' },
						{ path: 'data/fm-inbox-branch-bug/fix.patch', kind: 'patch', url: '/r?2' },
						{ path: 'data/gone/report.md', kind: 'report', url: null }
					]
				}
			})
		);
		const docs = [...document.querySelectorAll('[data-decision-doc]')].map((d) => [
			d.getAttribute('data-decision-doc'),
			d.textContent!.replace(/\s+/g, ' ').trim()
		]);
		expect(docs).toEqual([
			['report', 'Report data/fm-inbox-branch-bug/report.md'],
			['patch', 'Patch fix.patch'],
			['missing', 'Report data/gone/report.md (not found)']
		]);
		document.querySelector<HTMLButtonElement>('[data-decision-doc="patch"]')!.click();
		flushSync();
		await vi.waitFor(() =>
			expect(document.querySelector('[data-patch]')?.textContent).toContain('+added line')
		);
		expect(document.querySelector('dialog[data-doc-modal]')!.textContent).toContain('fix.patch');
		expect(document.querySelectorAll('[data-thumb-shot] img')).toHaveLength(1);
	});

	it('keeps Firstmate’s own words under Details, linking the Markdown files they name', () => {
		show(
			hold({
				question: 'Read data/wh-gateway-design/report.md and pick an option.',
				title: 'Pick an option?',
				choices: null,
				evidence: {
					...card().evidence,
					text: 'Options are in data/wh-gateway-design/options.md'
				}
			}),
			{ expanded: true }
		);
		const panel = document.querySelector('[data-details-panel]')!;
		expect(panel.textContent).toContain('fm-inbox-fix-call');
		expect(panel.textContent).toContain('Firstmate, from fm-inbox-branch-bug');
		const links = [...panel.querySelectorAll('a[data-doc-link]')].map((a) => [
			a.textContent,
			a.getAttribute('href')
		]);
		expect(links).toEqual([
			['data/wh-gateway-design/report.md', '/files?path=data%2Fwh-gateway-design%2Freport.md'],
			['data/wh-gateway-design/options.md', '/files?path=data%2Fwh-gateway-design%2Foptions.md']
		]);
		expect(document.querySelector('h3')?.textContent?.trim()).toBe('Pick an option?');
	});
});
