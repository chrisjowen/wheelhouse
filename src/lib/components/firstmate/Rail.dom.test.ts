import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { optionsFor, type InboxCard, type InboxView } from '$lib/inbox';
import { inbox } from '$lib/client/inbox.svelte';
import type { SecondMate } from '$lib/types';
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
	recommendation: { choice: 'approve', text: 'Behind a flag first.' },
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
		panel().querySelector<HTMLButtonElement>('[data-agree]')!.click();
		flushSync();
		expect(panel().querySelector('article')).toBeNull();
		expect(panel().textContent).not.toContain('Ship the share links');
		expect(tab()).toBe('Needs you');
		expect(panel().textContent).toContain('Nothing needs you right now.');
	});

	it('keeps the card of a hold the decision stack has no room for', () => {
		const ahead = ['a', 'b', 'c'].map((id): InboxCard => ({
			...hold,
			id: `${id}:captain-hold`,
			taskId: id,
			taskTitle: id,
			question: `Earlier call ${id}?`
		}));
		inbox.value = view([...ahead, hold]);
		needsYou();
		expect(panel().querySelectorAll('article')).toHaveLength(3);
		expect(panel().textContent).toContain('Ship the share links behind a flag, or to everyone?');
		expect(tab()).toBe('Needs you4');
	});

	it('keeps the plain card when the decision inbox cannot be read', () => {
		inbox.value = { ...view([]), available: false, reason: 'Firstmate is not set up.' };
		needsYou();
		expect(tab()).toBe('Needs you1');
		expect(panel().querySelector('article')).toBeNull();
		expect(panel().textContent).toContain('Ship the share links behind a flag, or to everyone?');
	});
});

describe("On deck's Under way and Second mates", () => {
	const asking = taskSummary('ask', 'with-firstmate', {
		shortTitle: 'Pick the export format',
		attention: { kind: 'decision', owner: 'firstmate', text: 'CSV or JSON?', url: null }
	});
	const working = taskSummary('build', 'working', { shortTitle: 'Build the export' });
	const closed = taskSummary('drop', 'closed', { shortTitle: 'An abandoned try' });
	const mate: SecondMate = {
		id: 'tokyo',
		where: 'remote',
		host: 'tokyo-box',
		home: '/home/fm/tokyo',
		stateLabel: 'Working',
		tone: 'working',
		health: {
			online: 'online',
			text: 'Online',
			reason: null,
			observedAt: null,
			ageSeconds: 10,
			cached: false,
			host: { cpu: null, memory: null, disk: null },
			hostNote: null
		},
		projects: ['lumen'],
		inFlight: [
			{
				id: 'tk-1',
				title: 'Add the share API',
				projectId: 'lumen',
				status: 'working',
				statusLabel: 'Working',
				doing: null,
				since: null,
				completedOn: null,
				pr: null,
				report: null
			}
		],
		queued: [],
		landed: [],
		prs: [],
		previews: [],
		previewNote: null,
		decisions: 0,
		captainDecisions: 0,
		omitted: [],
		lastReport: null,
		peek: { available: true, reason: null }
	};
	const open = (which: string) => {
		localStorage.setItem('wheelhouse-rail-tab', which);
		app = mount(Rail, {
			target: document.body,
			props: {
				tasks: [asking, working, closed],
				projects: [],
				secondMates: [mate],
				now: Date.now()
			}
		});
		flushSync();
	};

	it('keeps decisions and closed work out of Under way', () => {
		inbox.value = view([]);
		open('under');
		expect(panel().textContent).toContain('Build the export');
		expect(panel().textContent).not.toContain('Pick the export format');
		expect(panel().textContent).not.toContain('An abandoned try');
		expect(document.getElementById('rail-tab-under')!.textContent!.trim()).toBe('Under way1');
	});

	it('shows a worker’s question Firstmate is handling under Needs you', () => {
		inbox.value = view([]);
		open('needs');
		expect(panel().textContent).toContain('With Firstmate');
		expect(panel().textContent).toContain('CSV or JSON?');
	});

	it('gives second mates their own tab, each with its work under it', () => {
		inbox.value = view([]);
		open('mates');
		expect(document.getElementById('rail-tab-mates')!.textContent!.trim()).toBe('Second mates1');
		const m = panel().querySelector('[data-second-mate="tokyo"]')!;
		expect(m.textContent).toContain('Online');
		expect(m.textContent).toContain('on tokyo-box');
		expect(m.textContent).toContain('Add the share API');
	});
});
