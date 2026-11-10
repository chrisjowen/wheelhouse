import { flushSync, mount, tick, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { optionsFor, type InboxCard, type InboxView } from '$lib/inbox';
import { inbox } from '$lib/client/inbox.svelte';
import type { SecondMate, TaskSummary } from '$lib/types';
import { prGreen, taskSummary } from '../../../../tests/helpers/task-summary';
import { composerBus } from './bus.svelte';

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

const mate = (id: string, host: string | null, o: Partial<SecondMate> = {}): SecondMate => ({
	id,
	where: host ? 'remote' : 'local',
	host,
	home: `/home/fm/${id}`,
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
	inFlight: [],
	queued: [],
	landed: [],
	prs: [],
	previews: [],
	previewNote: null,
	decisions: 0,
	captainDecisions: 0,
	omitted: [],
	lastReport: null,
	peek: { available: true, reason: null },
	...o
});
const onMate = (t: TaskSummary, id: string, host: string | null): TaskSummary => ({
	...t,
	id: `${t.id}@${id}`,
	secondMate: { id, host, where: host ? 'remote' : 'local' }
});

let app: ReturnType<typeof mount> | null = null;
beforeEach(() => {
	// Reduced motion: an answered question leaves without its stamp (happy-dom cannot run it).
	vi.stubGlobal('matchMedia', () => ({
		matches: true,
		addEventListener: () => {},
		removeEventListener: () => {}
	}));
});

afterEach(() => {
	if (app) unmount(app);
	app = null;
	document.body.innerHTML = '';
	vi.unstubAllGlobals();
	localStorage.clear();
	inbox.value = null;
	inbox.pending = {};
	inbox.errors = {};
	inbox.snoozed = {};
	composerBus.pending = null;
});

const show = (
	which: string,
	tasks: TaskSummary[],
	secondMates: SecondMate[] = [],
	o: { onChat?: () => void } = {}
) => {
	localStorage.setItem('wheelhouse-rail-tab', which);
	app = mount(Rail, {
		target: document.body,
		props: { tasks, projects: [], secondMates, now: Date.now(), ...o }
	});
	flushSync();
};
const remount = (tasks: TaskSummary[], secondMates: SecondMate[]) => {
	if (app) unmount(app);
	document.body.innerHTML = '';
	app = mount(Rail, {
		target: document.body,
		props: { tasks, projects: [], secondMates, now: Date.now() }
	});
	flushSync();
};
const tabText = (id: string) => document.getElementById(`rail-tab-${id}`)!.textContent!.trim();
const panel = () => document.getElementById('rail-panel')!;
const lines = () => [...panel().querySelectorAll<HTMLButtonElement>('[data-deck-line]')];
const lineTexts = () => lines().map((b) => b.textContent!.replace(/\s+/g, ' ').trim());
const segments = () => [...document.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
const segment = (label: string) => segments().find((s) => s.textContent!.includes(label))!;
const settle = async () => {
	for (let i = 0; i < 5; i++) {
		await new Promise((r) => setTimeout(r, 0));
		await tick();
	}
	flushSync();
};

describe("On deck's Needs you", () => {
	it('shows a held decision once, as one line that opens to its decision box, and drops it when answered', async () => {
		inbox.value = view([hold]);
		vi.stubGlobal(
			'fetch',
			vi.fn(() => new Promise<Response>(() => {}))
		);
		show('needs', [held]);
		expect(tabText('needs')).toBe('Needs you1');
		expect(lines()).toHaveLength(1);
		expect(panel().textContent!.split('Ship the share links').length - 1).toBe(1);
		// Closed, it is one line; opened, the same decision box as the Decisions page.
		expect(panel().querySelector('article')).toBeNull();
		lines()[0].click();
		flushSync();
		expect(lines()[0].getAttribute('aria-expanded')).toBe('true');
		expect(panel().querySelectorAll('article')).toHaveLength(1);
		panel().querySelector<HTMLButtonElement>('[data-agree]')!.click();
		flushSync();
		// The box goes at once, before Firstmate has the answer; the line folds away after it.
		expect(panel().querySelector('article')).toBeNull();
		await settle();
		expect(panel().textContent).not.toContain('Ship the share links');
		expect(tabText('needs')).toBe('Needs you');
		expect(panel().textContent).toContain('Nothing needs you right now.');
	});

	it('shows only what Firstmate escalated, every one of them', () => {
		const ahead = ['a', 'b', 'c'].map((id): InboxCard => ({
			...hold,
			id: `${id}:captain-hold`,
			taskId: id,
			taskTitle: id,
			question: `Earlier call ${id}?`
		}));
		const theirs: InboxCard = {
			...hold,
			id: 'theme:pick',
			taskId: 'theme',
			kind: 'decision',
			key: 'pick',
			owner: 'firstmate',
			question: 'Navy or slate?'
		};
		inbox.value = view([...ahead, hold, theirs]);
		show('needs', [held]);
		expect(tabText('needs')).toBe('Needs you4');
		expect(lines()).toHaveLength(4);
		expect(panel().textContent).not.toContain('Navy or slate?');
	});

	it('keeps a decision whose answer was not taken, with the reason', async () => {
		inbox.value = view([hold]);
		vi.stubGlobal(
			'fetch',
			vi.fn(
				async () =>
					new Response(JSON.stringify({ message: 'Messaging to Firstmate is off.' }), {
						status: 503
					})
			)
		);
		show('needs', [held]);
		lines()[0].click();
		flushSync();
		panel().querySelector<HTMLButtonElement>('[data-agree]')!.click();
		await settle();
		expect(lines()).toHaveLength(1);
		expect(panel().querySelector('[role="alert"]')?.textContent).toBe(
			'Messaging to Firstmate is off.'
		);
	});

	it('keeps the held task’s own line when the decision inbox cannot be read', () => {
		inbox.value = { ...view([]), available: false, reason: 'Firstmate is not set up.' };
		show('needs', [held]);
		expect(tabText('needs')).toBe('Needs you1');
		expect(lineTexts()[0]).toContain('Ship the share links behind a flag, or to everyone?');
	});

	it('shows a worker’s question Firstmate is handling, marked as Firstmate’s', () => {
		inbox.value = view([]);
		const asking = taskSummary('ask', 'with-firstmate', {
			attention: { kind: 'decision', owner: 'firstmate', text: 'CSV or JSON?', url: null }
		});
		show('needs', [asking]);
		expect(lineTexts()).toEqual([expect.stringContaining('CSV or JSON?')]);
		expect(lines()[0].querySelector('[aria-label="Firstmate deciding"]')).not.toBeNull();
	});
});

describe("On deck's lines", () => {
	const review = {
		...prGreen('chart'),
		shortTitle: 'Fleet chart',
		activity: { text: 'Ready for your review: CI green', at: null, source: 'status' as const }
	};

	it('keeps decisions and closed work out of Under way', () => {
		inbox.value = view([]);
		const asking = taskSummary('ask', 'with-firstmate', { shortTitle: 'Pick the export format' });
		const working = taskSummary('build', 'working', { shortTitle: 'Build the export' });
		const closed = taskSummary('drop', 'closed', { shortTitle: 'An abandoned try' });
		show('under', [asking, working, closed]);
		expect(lineTexts()).toEqual([expect.stringContaining('Build the export')]);
		expect(tabText('under')).toBe('Under way1');
	});

	it('opens in place with what its card showed, and Open and Chat about this', () => {
		inbox.value = view([]);
		const onChat = vi.fn();
		show('needs', [review], [], { onChat });
		const line = lines()[0];
		expect(line.textContent).toContain('Fleet chart');
		expect(line.querySelector('[aria-label="Your review"]')).not.toBeNull();
		line.click();
		flushSync();
		const detail = document.getElementById(line.getAttribute('aria-controls')!)!;
		expect(detail.textContent).toContain('Your review');
		expect(detail.textContent).toContain('Pull request is ready for your review.');
		expect(detail.textContent).toContain('Ready for your review: CI green');
		expect(
			detail.querySelector('a[href="https://github.com/example/lumen/pull/42"]')
		).not.toBeNull();
		expect(detail.querySelector('a[href="/tasks/chart"]')!.textContent).toContain('Open');
		[...detail.querySelectorAll('button')]
			.find((b) => b.textContent!.includes('Chat about this'))!
			.click();
		expect(composerBus.pending).toMatchObject({ kind: 'task', id: 'chart', title: 'Fleet chart' });
		expect(onChat).toHaveBeenCalled();
		// Selecting it again folds it.
		line.click();
		flushSync();
		expect(line.getAttribute('aria-expanded')).toBe('false');
		expect(document.getElementById(line.getAttribute('aria-controls')!)).toBeNull();
	});

	it('moves between lines with the arrow keys', () => {
		inbox.value = view([]);
		show('under', [
			taskSummary('a', 'working', { shortTitle: 'First' }),
			taskSummary('b', 'working', { shortTitle: 'Second' })
		]);
		lines()[0].focus();
		lines()[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
		expect(document.activeElement).toBe(lines()[1]);
		lines()[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
		expect(document.activeElement).toBe(lines()[0]);
	});

	it('folds up next away until asked for', () => {
		inbox.value = view([]);
		show('under', [
			taskSummary('a', 'working'),
			taskSummary('later', 'queued', { shortTitle: 'Later on' })
		]);
		expect(panel().textContent).not.toContain('Later on');
		[...panel().querySelectorAll('button')]
			.find((b) => b.textContent!.includes('Up next'))!
			.click();
		flushSync();
		expect(panel().textContent).toContain('Later on');
	});
});

describe("On deck's crews", () => {
	const own = taskSummary('own', 'working', { shortTitle: 'Own work' });
	const north = onMate(
		taskSummary('pdf', 'working', { shortTitle: 'North work' }),
		'north-mate',
		'north-box'
	);
	const southCall = onMate(
		taskSummary('share', 'needs-decision', {
			shortTitle: 'South call',
			attention: { kind: 'decision', owner: 'captain', text: 'South asks?', url: null }
		}),
		'south-mate',
		'south-box'
	);
	const mates = [
		mate('north-mate', 'north-box'),
		mate('south-mate', 'south-box', {
			stateLabel: 'Needs your decision',
			lastReport: { text: 'working: share links', ageSeconds: 60 }
		})
	];
	const tasks = [own, north, southCall];

	it('groups the work by crew: Firstmate’s own first, then each second mate with its host', () => {
		inbox.value = view([]);
		show('under', tasks, mates);
		const groups = [...panel().querySelectorAll('[data-crew-group]')];
		expect(groups.map((g) => g.getAttribute('data-crew-group'))).toEqual([
			':firstmate',
			'north-mate'
		]);
		expect(groups[1].querySelector('h3')!.textContent).toContain('north-mate');
		expect(groups[1].querySelector('h3')!.textContent).toContain('on north-box');
		expect(groups[1].textContent).toContain('North work');
	});

	it('has a toggle with All and one segment per crew, short names and counts, blue for what waits on you', () => {
		inbox.value = view([]);
		show('under', tasks, mates);
		expect(
			segments().map((s) => s.textContent!.replace(/:.*/, '').replace(/\s+/g, ' ').trim())
		).toEqual(['All', 'Firstmate', 'north', 'south']);
		expect(segment('All').getAttribute('aria-checked')).toBe('true');
		// 3 in play, 1 waiting on you: the count shows what waits on you.
		expect(segment('All').textContent).toContain('3 in play, 1 waiting on you');
		expect(segment('south').querySelector('.bg-sea')!.textContent).toBe('1');
		expect(segment('north').textContent).toContain('1 in play');
	});

	it('narrows the rail to one crew, says how that second mate is, and remembers the choice', () => {
		inbox.value = view([]);
		show('needs', tasks, mates);
		segment('south').click();
		flushSync();
		expect(segment('south').getAttribute('aria-checked')).toBe('true');
		expect(localStorage.getItem('wheelhouse-rail-crew')).toBe('south-mate');
		expect(lineTexts()).toEqual([expect.stringContaining('South asks?')]);
		expect(tabText('needs')).toBe('Needs you1');
		const about = panel().querySelector('[data-second-mate="south-mate"]')!;
		expect(about.textContent).toContain('Online');
		expect(about.textContent).toContain('Needs your decision');
		expect(about.textContent).toContain('working: share links');
		expect(about.querySelector('a')!.getAttribute('href')).toBe('/second-mates#mate-south-mate');
		// Under way for that crew is empty, and says so under its heading.
		remount(tasks, mates);
		expect(segment('south').getAttribute('aria-checked')).toBe('true');
	});

	it('moves between crews with the arrow keys', () => {
		inbox.value = view([]);
		show('under', tasks, mates);
		segment('All').focus();
		segment('All').dispatchEvent(
			new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })
		);
		flushSync();
		expect(segment('Firstmate').getAttribute('aria-checked')).toBe('true');
		expect(document.activeElement).toBe(segment('Firstmate'));
		expect(lineTexts()).toEqual([expect.stringContaining('Own work')]);
		segment('Firstmate').dispatchEvent(
			new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })
		);
		flushSync();
		expect(segment('All').getAttribute('aria-checked')).toBe('true');
	});

	it('forgets a crew that has left the fleet', () => {
		inbox.value = view([]);
		localStorage.setItem('wheelhouse-rail-crew', 'gone-mate');
		show('under', tasks, mates);
		expect(segment('All').getAttribute('aria-checked')).toBe('true');
		expect(lines()).toHaveLength(2);
	});

	it('has no toggle or crew headings when Firstmate runs no second mates', () => {
		inbox.value = view([]);
		show('under', [own]);
		expect(segments()).toHaveLength(0);
		expect(panel().querySelector('h3')).toBeNull();
		expect(lineTexts()).toEqual([expect.stringContaining('Own work')]);
	});
});
