import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { optionsFor, type InboxCard } from '$lib/inbox';
import { inbox } from '$lib/client/inbox.svelte';
import type { Attention, TaskSummary } from '$lib/types';
import { taskSummary } from '../../../../tests/helpers/task-summary';

vi.mock('$app/state', () => ({ page: { data: {} } }));

const { default: TaskCallBar } = await import('./TaskCallBar.svelte');

const question = (owner: InboxCard['owner']): InboxCard => ({
	id: 'upload:captain-hold',
	taskId: 'upload',
	taskTitle: 'upload',
	projectId: 'lumen',
	kind: 'hold',
	key: 'captain-hold',
	question: 'Ship the share links behind a flag?',
	askedAt: null,
	owner,
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
		screenshots: []
	},
	options: optionsFor('hold', true),
	recommendation: null,
	choices: null,
	sent: null
});

const waiting = (kind: Attention['kind'], owner: Attention['owner'] = 'captain'): Attention => ({
	kind,
	owner,
	text: 'Over to you',
	url: null
});
const pr = { url: 'https://github.com/acme/lumen/pull/142', number: 142 };
const preview = { url: 'http://127.0.0.1:5173/', reportedAt: '2026-11-11T10:00:00Z' };

let app: ReturnType<typeof mount> | null = null;
afterEach(() => {
	if (app) unmount(app);
	app = null;
	document.body.innerHTML = '';
	inbox.value = null;
});

function bar(task: TaskSummary, onpreview: (from: HTMLElement) => void = () => {}) {
	app = mount(TaskCallBar, { target: document.body, props: { task, onpreview } });
	flushSync();
	return {
		call: document.querySelector('[data-call]')?.getAttribute('data-call') ?? null,
		chat: document.querySelector('a[href^="/?chat="]')?.getAttribute('href')
	};
}

describe("the task page's call bar on a phone", () => {
	it('always offers the chat about the task', () => {
		expect(bar(taskSummary('upload', 'working'))).toEqual({ call: null, chat: '/?chat=upload' });
	});

	it("answers the task's question while the decision is the captain's", () => {
		inbox.value = {
			schema: 'wheelhouse-inbox.v1',
			available: true,
			reason: null,
			canAnswer: true,
			cards: [question('captain')]
		};
		const task = taskSummary('upload', 'needs-decision', { attention: waiting('decision'), pr });
		expect(bar(task).call).toBe('answer');
	});

	it('leaves a question Firstmate is handling to Firstmate', () => {
		inbox.value = {
			schema: 'wheelhouse-inbox.v1',
			available: true,
			reason: null,
			canAnswer: true,
			cards: [question('firstmate')]
		};
		const task = taskSummary('upload', 'working', {
			attention: waiting('decision', 'firstmate')
		});
		expect(bar(task).call).toBeNull();
	});

	it('reviews the pull request while the work waits on the captain', () => {
		const task = taskSummary('upload', 'needs-review', {
			attention: waiting('review'),
			pr,
			preview
		});
		expect(bar(task).call).toBe('review');
		expect(document.querySelector('[data-call]')?.getAttribute('href')).toBe(pr.url);
		expect(document.querySelector('[data-call]')?.textContent).toContain('Review #142');
	});

	it('else opens the live preview from the button pressed', () => {
		const opened: HTMLElement[] = [];
		const task = taskSummary('upload', 'working', { preview });
		expect(bar(task, (from: HTMLElement) => opened.push(from)).call).toBe('preview');
		document.querySelector<HTMLButtonElement>('[data-call]')!.click();
		expect(opened).toEqual([document.querySelector('[data-call]')]);
	});
});
