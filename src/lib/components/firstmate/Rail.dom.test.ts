import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { optionsFor, type InboxCard, type InboxView } from '$lib/inbox';
import { inbox } from '$lib/client/inbox.svelte';
import { taskSummary } from '../../../../tests/helpers/task-summary';

vi.mock('$app/state', () => ({ page: { data: { sessionToken: 'tok' } } }));

const { default: Rail } = await import('./Rail.svelte');

const held = taskSummary('upload', 'needs-decision', {
	attention: {
		kind: 'decision',
		owner: 'captain',
		text: 'Ship the share links behind a flag, or to everyone?',
		url: null
	}
});
const hold: InboxCard = {
	id: 'upload:captain-hold',
	taskId: 'upload',
	taskTitle: 'upload',
	projectId: 'lumen',
	kind: 'hold',
	key: 'captain-hold',
	question: 'Ship the share links behind a flag, or to everyone?',
	askedAt: null,
	owner: 'captain',
	evidence: {
		text: null,
		report: null,
		findings: [],
		file: null,
		pr: null,
		preview: null,
		checks: null,
		screenshots: []
	},
	options: optionsFor('hold'),
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

let app: ReturnType<typeof mount> | null = null;
afterEach(() => {
	if (app) unmount(app);
	app = null;
	document.body.innerHTML = '';
	vi.unstubAllGlobals();
	localStorage.clear();
	inbox.value = null;
	inbox.pending = {};
	inbox.errors = {};
});

const needsYou = () => {
	localStorage.setItem('wheelhouse-rail-tab', 'needs');
	app = mount(Rail, {
		target: document.body,
		props: { tasks: [held], projects: [], now: Date.now() }
	});
	flushSync();
};
const tab = () => document.getElementById('rail-tab-needs')!.textContent!.trim();
const panel = () => document.getElementById('rail-panel')!;

describe("On deck's Needs you", () => {
	it('shows a held decision once, as its decision box, and drops it when answered', () => {
		inbox.value = view([hold]);
		vi.stubGlobal(
			'fetch',
			vi.fn(() => new Promise<Response>(() => {}))
		);
		needsYou();
		expect(tab()).toBe('Needs you1');
		expect(panel().querySelectorAll('article')).toHaveLength(1);
		expect(panel().textContent!.split('Ship the share links').length - 1).toBe(1);
		[...panel().querySelectorAll('button')]
			.find((b) => b.textContent?.trim() === 'Approve')!
			.click();
		flushSync();
		expect(panel().querySelector('article')).toBeNull();
		expect(panel().textContent).not.toContain('Ship the share links');
		expect(tab()).toBe('Needs you');
		expect(panel().textContent).toContain('Nothing needs you right now.');
	});

	it('keeps the plain card when the decision inbox cannot be read', () => {
		inbox.value = { ...view([]), available: false, reason: 'Firstmate is not set up.' };
		needsYou();
		expect(tab()).toBe('Needs you1');
		expect(panel().querySelector('article')).toBeNull();
		expect(panel().textContent).toContain('Ship the share links behind a flag, or to everyone?');
	});
});
