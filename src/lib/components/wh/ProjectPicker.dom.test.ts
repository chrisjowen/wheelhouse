import { flushSync, mount, unmount } from 'svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PINS_KEY, pins } from '$lib/client/pins.svelte';
import { ALIASES_KEY, aliases } from '$lib/client/aliases.svelte';
import { PICKER_LIMIT, statsByProject } from '$lib/picker';
import type { Project } from '$lib/types';
import { taskSummary } from '../../../../tests/helpers/task-summary';
import ProjectList from './ProjectList.svelte';
import ProjectNav from './ProjectNav.test-fixture.svelte';

const goto = vi.hoisted(() => vi.fn());
vi.mock('$app/navigation', () => ({ goto }));

const NOW = Date.parse('2026-10-27T12:00:00Z');
const you = { kind: 'review' as const, owner: 'captain' as const, text: '', url: null };
const NAMES = ['Tidewatch', 'Lumen', 'Harbour map', 'Ship log', 'Wheelhouse'];

// A big fleet: 40 projects, a few of them busy.
const projects: Project[] = Array.from({ length: 40 }, (_, i) => ({
	id: `p${String(i).padStart(2, '0')}`,
	name: NAMES[i] ?? `Project ${String(i).padStart(2, '0')}`,
	description: null,
	posture: null,
	registered: true,
	path: null,
	passage: null
}));
const tasks = [
	taskSummary('a', 'needs-review', { projectId: 'p30', attention: you }),
	taskSummary('b', 'needs-decision', { projectId: 'p30', attention: { ...you, kind: 'decision' } }),
	taskSummary('c', 'working', { projectId: 'p12', since: '2026-10-27T11:00:00Z' })
];
const stats = statsByProject(projects, tasks, NOW);
const needCount = (id: string) =>
	tasks.filter((t) => (id === 'all' || t.projectId === id) && t.attention?.owner === 'captain')
		.length;
const href = (id: string) => (id === 'all' ? '/' : `/?project=${id}`);

const rows = () =>
	[...document.querySelectorAll<HTMLElement>('nav [data-project]')].map((r) => r.dataset.project);
const options = () =>
	[...document.querySelectorAll<HTMLElement>('[role="option"]')].map((o) => o.dataset.project);
const button = (label: string) =>
	[...document.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
		b.textContent?.trim().startsWith(label)
	)!;
function type(input: HTMLInputElement, value: string) {
	input.value = value;
	input.dispatchEvent(new Event('input', { bubbles: true }));
	flushSync();
}
/** Opens a left-panel row's menu and picks one of its items. */
async function rowMenu(name: string, item: string) {
	const trigger = document.querySelector<HTMLButtonElement>(`[aria-label="Options for ${name}"]`)!;
	trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
	flushSync();
	await new Promise((r) => setTimeout(r, 0));
	const entry = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((m) =>
		m.textContent?.trim().startsWith(item)
	)!;
	entry.click();
	flushSync();
	await new Promise((r) => setTimeout(r, 0));
	flushSync();
}
const key = (el: Element, k: string) => {
	el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
	flushSync();
};

beforeEach(() => {
	document.body.innerHTML = '';
	localStorage.clear();
	pins.ids = [];
	goto.mockClear();
});

describe('the left panel’s projects', () => {
	const open = (current = 'all') =>
		mount(ProjectNav, {
			target: document.body,
			props: { projects, stats, current, needCount, href }
		});

	it('shows a few projects, most active first, with Show all for the rest', () => {
		const app = open();
		flushSync();
		expect(rows()).toHaveLength(1 + PICKER_LIMIT);
		expect(rows().slice(0, 3)).toEqual(['all', 'p30', 'p12']);
		expect(document.querySelector('a[href="/?project=p30"]')!.getAttribute('aria-label')).toBe(
			'Project 30, 2 need you'
		);
		button('Show all 40').click();
		flushSync();
		expect(rows()).toHaveLength(41);
		button('Show fewer').click();
		flushSync();
		expect(rows()).toHaveLength(1 + PICKER_LIMIT);
		unmount(app);
	});

	it('folded to the icon rail, shows only the pinned and top ones even after Show all', () => {
		const app = open();
		flushSync();
		button('Show all 40').click();
		flushSync();
		expect(rows()).toHaveLength(41);
		app.fold(true);
		flushSync();
		expect(rows()).toHaveLength(1 + PICKER_LIMIT);
		app.fold(false);
		flushSync();
		expect(rows()).toHaveLength(41);
		unmount(app);
	});

	it('keeps the current project in view', () => {
		const app = open('p25');
		flushSync();
		expect(rows()).toContain('p25');
		unmount(app);
	});

	it('pins a project to the top from its menu, remembered in this browser', async () => {
		const app = open();
		flushSync();
		button('Show all').click();
		flushSync();
		await rowMenu('Project 33', 'Pin');
		button('Show fewer').click();
		flushSync();
		expect(rows().slice(0, 3)).toEqual(['all', 'p33', 'p30']);
		expect(document.body.textContent).toContain('Pinned');
		expect(JSON.parse(localStorage.getItem(PINS_KEY)!)).toEqual(['p33']);
		await rowMenu('Project 33', 'Unpin');
		expect(rows()).not.toContain('p33');
		unmount(app);
	});

	it('finds any project by name, and Enter opens the best match', () => {
		const app = open();
		flushSync();
		const find = document.querySelector<HTMLInputElement>('input[aria-label="Find a project"]')!;
		type(find, 'map');
		expect(rows()).toEqual(['p02']);
		type(find, 'project 3');
		expect(rows()).toHaveLength(10);
		type(find, 'nothing like it');
		expect(document.body.textContent).toContain('No project matches “nothing like it”.');
		type(find, 'ship');
		key(find, 'Enter');
		expect(goto).toHaveBeenCalledWith('/?project=p03');
		expect(find.value).toBe('');
		unmount(app);
	});
});

describe('the header’s project picker', () => {
	const open = (current = 'all') => {
		const onpick = vi.fn();
		const app = mount(ProjectList, {
			target: document.body,
			props: { projects, stats, current, needCount, onpick }
		});
		flushSync();
		const input = document.querySelector<HTMLInputElement>('input[role="combobox"]')!;
		return { app, onpick, input };
	};
	const active = () =>
		document.querySelector<HTMLElement>('[aria-selected="true"]')?.dataset.project;

	it('lists All projects, the most active and then the rest, starting on the current one', () => {
		const { app, input } = open('p12');
		expect(options()).toHaveLength(41);
		expect(options().slice(0, 3)).toEqual(['all', 'p30', 'p12']);
		expect(document.body.textContent).toContain('Most active');
		expect(document.body.textContent).toContain('Other projects');
		expect(document.body.textContent).toContain('2 need you');
		expect(active()).toBe('p12');
		expect(input.getAttribute('aria-activedescendant')).toBe(
			document.querySelector('[aria-selected="true"]')!.id
		);
		unmount(app);
	});

	it('filters as you type; arrows move and Enter picks', () => {
		const { app, onpick, input } = open();
		type(input, 'project 1');
		expect(options()).toHaveLength(10);
		expect(active()).toBe('p10');
		key(input, 'ArrowDown');
		key(input, 'ArrowDown');
		expect(active()).toBe('p12');
		key(input, 'ArrowUp');
		key(input, 'Enter');
		expect(onpick).toHaveBeenCalledWith('p11');
		type(input, 'zzz');
		expect(options()).toEqual([]);
		expect(document.body.textContent).toContain('No project matches “zzz”.');
		unmount(app);
	});

	it('pins from the menu, the same pins as the panel', () => {
		const { app } = open();
		document.querySelector<HTMLButtonElement>('[aria-label="Pin Wheelhouse"]')!.click();
		flushSync();
		expect(options().slice(0, 2)).toEqual(['all', 'p04']);
		expect(document.body.textContent).toContain('Pinned');
		expect(pins.ids).toEqual(['p04']);
		unmount(app);
	});
});

describe('long project names', () => {
	// Siblings that share a prefix, and an ordinary name; all busy enough to show.
	const fleet: Project[] = [
		'ai-innovations-chat-agent',
		'ai-innovations-workflow',
		'ai-innovations-evals',
		'lumen'
	].map((name) => ({ ...projects[0], id: name, name }));
	const fleetStats = statsByProject(fleet, [], NOW);
	const none = () => 0;

	beforeEach(() => aliases.set('ai-innovations-workflow', ''));

	it('the panel gathers siblings under their prefix, by their own part, with a monogram each', () => {
		const app = mount(ProjectNav, {
			target: document.body,
			props: { projects: fleet, stats: fleetStats, current: 'all', needCount: none, href }
		});
		flushSync();
		const group = button('ai-innovations');
		expect(group.getAttribute('aria-expanded')).toBe('true');
		const chat = document.querySelector('[data-project="ai-innovations-chat-agent"] a')!;
		expect(chat.textContent).toContain('chat-agent');
		expect(chat.textContent).not.toContain('ai-innovations');
		expect(chat.getAttribute('aria-label')).toBe('ai-innovations-chat-agent');
		const tiles = [...document.querySelectorAll('nav .project-tile')].map((t) => t.textContent);
		expect(tiles).toEqual(expect.arrayContaining(['CA', 'WO', 'EV', 'LU']));
		group.click();
		flushSync();
		expect(rows()).toEqual(['all', 'lumen']);
		unmount(app);
	});

	it('renames a project from its menu, kept in this browser and found by search', async () => {
		const app = mount(ProjectNav, {
			target: document.body,
			props: { projects: fleet, stats: fleetStats, current: 'all', needCount: none, href }
		});
		flushSync();
		await rowMenu('ai-innovations-workflow', 'Rename');
		await new Promise((r) => setTimeout(r, 0));
		flushSync();
		const field = document.querySelector<HTMLInputElement>(
			'input[aria-label="Friendly name for ai-innovations-workflow"]'
		)!;
		field.value = 'Flow builder';
		field.dispatchEvent(new Event('input', { bubbles: true }));
		field.form!.requestSubmit();
		flushSync();
		const row = document.querySelector('[data-project="ai-innovations-workflow"] a')!;
		expect(row.textContent).toContain('Flow builder');
		expect(row.querySelector('.project-tile')!.textContent).toBe('FB');
		expect(JSON.parse(localStorage.getItem(ALIASES_KEY)!)).toEqual({
			'ai-innovations-workflow': 'Flow builder'
		});
		const find = document.querySelector<HTMLInputElement>('input[aria-label="Find a project"]')!;
		type(find, 'flow b');
		expect(rows()).toEqual(['ai-innovations-workflow']);
		unmount(app);
	});

	it('the header picker shows the prefix as a heading, and the arrows follow the rows', () => {
		const onpick = vi.fn();
		const app = mount(ProjectList, {
			target: document.body,
			props: { projects: fleet, stats: fleetStats, current: 'all', needCount: none, onpick }
		});
		flushSync();
		const shown = options();
		expect(shown.slice(1, 4).every((id) => id!.startsWith('ai-innovations-'))).toBe(true);
		expect(document.body.textContent).toContain('ai-innovations');
		const input = document.querySelector<HTMLInputElement>('input[role="combobox"]')!;
		key(input, 'ArrowDown');
		key(input, 'Enter');
		expect(onpick).toHaveBeenCalledWith(shown[1]);
		unmount(app);
	});
});
