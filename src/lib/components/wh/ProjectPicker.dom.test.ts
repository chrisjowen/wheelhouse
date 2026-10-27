import { flushSync, mount, unmount } from 'svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PINS_KEY, pins } from '$lib/client/pins.svelte';
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

	it('pins a project to the top, remembered in this browser', () => {
		const app = open();
		flushSync();
		button('Show all').click();
		flushSync();
		document.querySelector<HTMLButtonElement>('[aria-label="Pin Project 33"]')!.click();
		flushSync();
		button('Show fewer').click();
		flushSync();
		expect(rows().slice(0, 3)).toEqual(['all', 'p33', 'p30']);
		expect(document.body.textContent).toContain('Pinned');
		expect(JSON.parse(localStorage.getItem(PINS_KEY)!)).toEqual(['p33']);
		document.querySelector<HTMLButtonElement>('[aria-label="Unpin Project 33"]')!.click();
		flushSync();
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
