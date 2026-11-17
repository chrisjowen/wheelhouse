import { flushSync, mount, tick, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { optionsFor, type InboxCard, type InboxView } from '$lib/inbox';
import { inbox } from '$lib/client/inbox.svelte';
import type { SecondMate, TaskSummary } from '$lib/types';
import { prGreen, taskSummary } from '../../../../tests/helpers/task-summary';
import { slideout } from '$lib/client/slideout.svelte';
import { live } from '$lib/client/live.svelte';
import type { FleetView } from '$lib/types';

const nav = vi.hoisted(() => ({ goto: vi.fn() }));
vi.mock('$app/state', () => ({
	page: { data: { sessionToken: 'tok' }, url: new URL('http://wh.test/') }
}));
vi.mock('$app/navigation', () => nav);

const { default: Rail } = await import('./Rail.svelte');
// The slide-outs every page shares, as the layout draws them.
const { default: SlideoutHost } = await import('$lib/components/wh/SlideoutHost.svelte');

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
	title: 'Ship the share links behind a flag, or to everyone?',
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
		checks: null,
		screenshots: [],
		docs: []
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
	link: null,
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
	if (host) unmount(host);
	host = null;
	slideout.close();
	nav.goto.mockReset();
	live.fleet = null;
	document.body.innerHTML = '';
	vi.unstubAllGlobals();
	localStorage.clear();
	inbox.value = null;
	inbox.pending = {};
	inbox.errors = {};
	inbox.snoozed = {};
});

let host: ReturnType<typeof mount> | null = null;
const show = (which: string, tasks: TaskSummary[], secondMates: SecondMate[] = []) => {
	localStorage.setItem('wheelhouse-rail-tab', which);
	app = mount(Rail, {
		target: document.body,
		props: { tasks, projects: [], secondMates, now: Date.now() }
	});
	host = mount(SlideoutHost, { target: document.body });
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
	it('shows a held decision as a badge, not a copy, that opens it in the Decisions slide-out, and drops it when answered', async () => {
		inbox.value = view([hold]);
		const posts: unknown[] = [];
		vi.stubGlobal(
			'fetch',
			vi.fn((url: string, init?: RequestInit) => {
				if (url === '/api/inbox' && init?.method === 'POST') {
					posts.push(JSON.parse(String(init.body)));
					return Promise.resolve(Response.json({ message: { delivery: 'delivered' } }));
				}
				return new Promise<Response>(() => {});
			})
		);
		show('needs', [held]);
		expect(tabText('needs')).toBe('Needs you1');
		// Not a line of its own, and nothing to answer on deck: one badge.
		expect(lines()).toHaveLength(0);
		expect(panel().querySelector('article')).toBeNull();
		const badge = panel().querySelector<HTMLButtonElement>('[data-decisions-badge]')!;
		expect(badge.dataset.decisionsBadge).toBe('waiting');
		expect(badge.textContent).toMatch(/1 decision\s*waiting on you/);
		expect(badge.textContent).toContain('Ship the share links');
		badge.click();
		await settle();
		expect(slideout.panel).toMatchObject({ kind: 'decisions', cardId: 'upload:captain-hold' });
		const out = document.querySelector<HTMLElement>('[data-decision-slideout]')!;
		expect(out.querySelectorAll('article')).toHaveLength(1);
		out.querySelector<HTMLButtonElement>('[data-option="approve"]')!.click();
		await settle();
		expect(posts).toEqual([{ cardId: 'upload:captain-hold', choice: 'approve', note: null }]);
		// Gone from deck at once, before Firstmate has the answer.
		expect(panel().querySelector('[data-decisions-badge]')).toBeNull();
		expect(tabText('needs')).toBe('Needs you');
		expect(panel().textContent).toContain('Nothing needs you right now.');
	});

	it('counts what Firstmate escalated, every one of them, on its tab', () => {
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
			question: 'Navy or slate?',
			title: 'Navy or slate?'
		};
		inbox.value = view([...ahead, hold, theirs]);
		show('needs', [held]);
		expect(tabText('needs')).toBe('Needs you4');
		expect(lines()).toHaveLength(0);
		const badge = panel().querySelector<HTMLElement>('[data-decisions-badge]')!;
		expect(badge.textContent).toMatch(/5 decisions\s*4 waiting on you/);
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
		panel().querySelector<HTMLButtonElement>('[data-decisions-badge]')!.click();
		await settle();
		const out = () => document.querySelector<HTMLElement>('[data-decision-slideout]')!;
		out().querySelector<HTMLButtonElement>('[data-option="approve"]')!.click();
		await settle();
		expect(panel().querySelector('[data-decisions-badge]')).not.toBeNull();
		expect(out().querySelector('[role="alert"]')?.textContent).toBe(
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
		expect(lines()[0].querySelector('.state-icon')!.getAttribute('aria-label')).toBe(
			'Firstmate deciding'
		);
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

	it('slides the task out with its overview, Open full page and Chat about this', async () => {
		inbox.value = view([]);
		vi.stubGlobal(
			'fetch',
			vi.fn(() => new Promise<Response>(() => {}))
		);
		live.fleet = { tasks: [review], projects: [] } as unknown as FleetView;
		// The task page under the overview follows its crew's talk; nothing streams here.
		vi.stubGlobal(
			'EventSource',
			class {
				addEventListener() {}
				close() {}
			}
		);
		show('needs', [review]);
		const line = lines()[0];
		expect(line.textContent).toContain('Fleet chart');
		expect(line.querySelector('.state-icon')!.getAttribute('aria-label')).toBe('Your review');
		expect(line.getAttribute('aria-haspopup')).toBe('dialog');
		expect(document.querySelector('[data-task-slideout]')).toBeNull();
		line.click();
		await settle();
		expect(slideout.taskId).toBe('chart');
		const panel = document.querySelector<HTMLElement>('[data-task-slideout]')!;
		expect(panel.getAttribute('role')).toBe('dialog');
		expect(panel.textContent).toContain('Fleet chart');
		expect(panel.querySelector('[data-slideout-attention]')!.textContent).toContain(
			'Ready for your review'
		);
		expect(panel.querySelector('[data-slideout-pr]')!.textContent).toContain('#42');
		expect(panel.querySelector('[data-open-full-page]')!.getAttribute('href')).toBe('/tasks/chart');
		[...panel.querySelectorAll('button')]
			.find((b) => b.textContent!.includes('Chat about this'))!
			.click();
		await settle();
		expect(nav.goto).toHaveBeenCalledWith('/?chat=chart');
		// Chatting about it puts the slide-out away.
		expect(document.querySelector('[data-task-slideout]')).toBeNull();
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

	it('names a Fleetyard second mate’s place by its machine, never its host alias', () => {
		inbox.value = view([]);
		const cloud = onMate(
			taskSummary('cloud', 'working', { shortTitle: 'Cloud work' }),
			'cloud-mate',
			'fy-mate-demo'
		);
		show('under', [cloud], [mate('cloud-mate', 'fy-mate-demo')]);
		const head = panel().querySelector('[data-crew="cloud-mate"]')!;
		expect(head.textContent).toContain('via Fleetyard · mate-demo');
		expect(head.querySelector('button')!.getAttribute('aria-label')).toContain(
			'via Fleetyard · mate-demo'
		);
		expect(segment('cloud').getAttribute('title')).toContain('via Fleetyard · mate-demo');
		expect(panel().innerHTML).not.toContain('fy-mate-demo');
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

describe('the bridge at a glance', () => {
	const project = (id: string) => ({
		id,
		name: id,
		description: null,
		posture: null,
		registered: true,
		path: null,
		passage: null
	});
	const insights = (percentLeft: number | null) => ({
		schema: 'wheelhouse-rail-insights.v1' as const,
		decisions: [],
		today: [],
		allowance:
			percentLeft === null
				? { state: 'unavailable' as const, reason: 'off' }
				: {
						state: 'ok' as const,
						readAt: '2026-11-10T10:00:00Z',
						windows: [
							{
								id: 'five_hour',
								label: 'This session',
								percentLeft: 64,
								resetsAt: null,
								atRisk: false,
								runsOutAt: null
							},
							{
								id: 'seven_day',
								label: 'This week',
								percentLeft,
								resetsAt: null,
								atRisk: false,
								runsOutAt: null
							}
						]
					},
		atRisk: null
	});
	const mountRail = (tasks: TaskSummary[], o: Record<string, unknown> = {}) => {
		app = mount(Rail, {
			target: document.body,
			props: { tasks, projects: [], secondMates: [], now: Date.now(), ...o }
		});
		flushSync();
	};
	const gauge = (href: string) =>
		document.querySelector<HTMLAnchorElement>(`[data-gauges] a[href="${href}"]`)!;

	it('reads the week’s headroom and the checks as gauges', () => {
		mountRail(
			[
				taskSummary('a', 'working'),
				taskSummary('b', 'working'),
				taskSummary('c', 'failed'),
				taskSummary('d', 'working'),
				taskSummary('e', 'landed')
			],
			{ insights: insights(26) }
		);
		const week = gauge('/headroom');
		expect(week.getAttribute('aria-label')).toBe('Claude headroom: This week, 26% left');
		expect(week.querySelector('.gauge-label')!.textContent).toBe('26%');
		const checks = gauge('/harbour');
		expect(checks.getAttribute('aria-label')).toBe(
			'Checks: 75% of the work in play has nothing failing, 1 failing'
		);
		expect(checks.textContent).toContain('1 of 4 in play failing');
	});

	it('shows an empty headroom gauge until Claude’s limits are read', () => {
		mountRail([], { insights: insights(null) });
		const week = gauge('/headroom');
		expect(week.querySelector('.gauge-label')!.textContent).toBe('–');
		expect(week.querySelector('.gauge-value')).toBeNull();
		expect(gauge('/harbour').textContent).toContain('Nothing in play');
	});

	it('leads each line with its state as an icon, its words as its label', () => {
		show('under', [taskSummary('build', 'working', { busy: true, shortTitle: 'Build it' })]);
		const line = lines()[0];
		const icon = line.firstElementChild!.querySelector('svg')!;
		expect(icon.matches('.state-icon[role="img"]')).toBe(true);
		expect(icon.getAttribute('aria-label')).toBe('Working');
		expect(icon.getAttribute('data-icon')).toBe('sailing');
		expect(icon.getAttribute('data-tone')).toBe('busy');
		expect(line.firstElementChild!.querySelector('.tip')!.textContent).toBe('Working');
		expect(line.textContent).toContain('Build it');
	});

	it('lists the busiest projects in Harbour at a glance, with their share landed', () => {
		mountRail(
			[
				taskSummary('a1', 'working', { projectId: 'atlas', busy: true }),
				taskSummary('a2', 'landed', { projectId: 'atlas' }),
				taskSummary('l1', 'landed', { projectId: 'lumen' })
			],
			{ projects: [project('atlas'), project('lumen'), project('quiet')] }
		);
		const rows = [...document.querySelectorAll<HTMLAnchorElement>('[data-glance] li a')];
		expect(rows.map((r) => r.getAttribute('aria-label'))).toEqual([
			'atlas: Working, 50% of its work landed',
			'lumen: Quiet, 100% of its work landed'
		]);
		expect(rows[0].getAttribute('href')).toBe('/projects/atlas');
	});

	it('keeps Harbour at a glance to the project the rail is scoped to', () => {
		mountRail(
			[
				taskSummary('a1', 'working', { projectId: 'atlas' }),
				taskSummary('l1', 'working', { projectId: 'lumen' })
			],
			{ projects: [project('atlas'), project('lumen')], scope: 'lumen' }
		);
		const rows = [...document.querySelectorAll('[data-glance] li a')];
		expect(rows.map((r) => r.getAttribute('href'))).toEqual(['/projects/lumen']);
	});
});
